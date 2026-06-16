/**
 * @module VotingConsensusService
 * @path packages-team/voting/src/voting_consensus_service.ts
 * @ungrounded
 * @description Concensus resolution service for voting_group flow steps.
 * Fans out N runners, collects candidates, and resolves majority/weighted/llm-judge consensus.
 * Supports halt_on_no_consensus governance via IPlanAmendmentService.
 * @architectural-layer Voting
 * @dependencies [packages/core/src/types/i_executor.ts, packages/core/src/types/i_voting_consensus_service.ts]
 * @related-files [packages/schemas/src/voting.ts, packages/core/src/events/domain_event_types.ts]
 */

import type { VotingCandidate, VotingGroupConfig, VotingResult } from "@exaix/schemas/voting.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import {
  type ICostTracker,
  type IExecutor,
  type IPlanAmendmentService,
  type IVotingConsensusService,
  VotingStrategy,
} from "@exaix/core/types";
import type { IPlanAmendmentTrigger } from "@exaix/schemas/plan_amendment.ts";

export class VotingConsensusService implements IVotingConsensusService {
  #executor: IExecutor;
  #logger: IEventLogger;
  #amendmentService?: IPlanAmendmentService;
  #costTracker?: ICostTracker;

  constructor(
    executor: IExecutor,
    logger: IEventLogger,
    amendmentService?: IPlanAmendmentService,
    costTracker?: ICostTracker,
  ) {
    this.#executor = executor;
    this.#logger = logger;
    this.#amendmentService = amendmentService;
    this.#costTracker = costTracker;
  }

  async run(
    config: VotingGroupConfig,
    basePrompt: string,
    traceId: string,
  ): Promise<VotingResult> {
    await this.#logger.info(DomainEventType.VotingStarted, traceId, {
      step_id: traceId,
      strategy: config.strategy,
      candidate_count: config.runners.length,
      consensus_reached: false,
    });

    const settled = await Promise.allSettled(
      config.runners.map(async (runner) => {
        const promptWithVariant = runner.prompt_variant
          ? `${basePrompt}\n\nContext: ${runner.prompt_variant}`
          : basePrompt;
        const result = await this.#executor.run(
          runner.blueprint,
          promptWithVariant,
        );
        return {
          runner_id: runner.blueprint,
          response: result.content,
          confidence: result.confidence,
        } satisfies VotingCandidate;
      }),
    );

    const candidates: VotingCandidate[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") {
        candidates.push(result.value);
        if (this.#costTracker) {
          await this.#costTracker.trackGeneration(
            result.value.runner_id,
            "voting-runner",
            { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            traceId,
          );
        }
      } else {
        await this.#logger.info(DomainEventType.VotingRunnerFailed, traceId, {
          step_id: traceId,
          strategy: config.strategy,
          candidate_count: config.runners.length,
          consensus_reached: false,
          error: result.reason?.message ?? String(result.reason),
        });
      }
    }

    if (candidates.length === 0) {
      return this.#emitNoConsensus(traceId, config, candidates, "All runners failed");
    }

    const winner = config.strategy === VotingStrategy.WEIGHTED
      ? this.#resolveWeighted(candidates)
      : config.strategy === VotingStrategy.LLM_JUDGE
      ? await this.#resolveLlmJudge(candidates, config, traceId)
      : this.#resolveMajority(candidates);

    if (!winner) {
      return this.#emitNoConsensus(traceId, config, candidates);
    }

    const result: VotingResult = {
      trace_id: traceId,
      strategy: config.strategy,
      winner,
      candidates,
      consensus_reached: true,
    };
    await this.#logger.info(DomainEventType.VotingResolved, traceId, {
      step_id: traceId,
      strategy: config.strategy,
      candidate_count: candidates.length,
      consensus_reached: true,
      winner_runner_id: winner.runner_id,
    });
    return result;
  }

  async #emitNoConsensus(
    traceId: string,
    config: VotingGroupConfig,
    candidates: VotingCandidate[],
    overrideMessage?: string,
  ): Promise<VotingResult> {
    const maxConfidence = candidates.reduce(
      (best, c) => (c.confidence ?? 0) > (best.confidence ?? 0) ? c : best,
      candidates[0] ?? { runner_id: "", response: "" },
    );
    const dissentSummary = overrideMessage ??
      `No consensus reached among ${candidates.length} candidate(s)`;

    const result: VotingResult = {
      trace_id: traceId,
      strategy: config.strategy,
      winner: maxConfidence,
      candidates,
      consensus_reached: false,
      dissent_summary: dissentSummary,
    };

    if (config.halt_on_no_consensus && this.#amendmentService) {
      const trigger: IPlanAmendmentTrigger = {
        source: "voting_no_consensus",
        stepId: traceId,
        reason: dissentSummary,
      };
      await this.#amendmentService.shouldAmend(trigger);
    }

    await this.#logger.info(DomainEventType.VotingNoConsensus, traceId, {
      step_id: traceId,
      strategy: config.strategy,
      candidate_count: candidates.length,
      consensus_reached: false,
      dissent_summary: dissentSummary,
    });

    return result;
  }

  async #resolveLlmJudge(
    candidates: VotingCandidate[],
    config: VotingGroupConfig,
    traceId: string,
  ): Promise<VotingCandidate | null> {
    if (!config.judge_blueprint) {
      await this.#logger.info(DomainEventType.VotingRunnerFailed, traceId, {
        step_id: traceId,
        strategy: config.strategy,
        candidate_count: candidates.length,
        consensus_reached: false,
        error: "No judge_blueprint configured for llm-judge strategy",
      });
      return null;
    }

    const judgePrompt = this.#buildJudgePrompt(candidates);

    try {
      const result = await this.#executor.run(config.judge_blueprint, judgePrompt);
      return this.#parseJudgeVerdict(result.content, candidates);
    } catch (err) {
      await this.#logger.info(DomainEventType.VotingRunnerFailed, traceId, {
        step_id: traceId,
        strategy: config.strategy,
        candidate_count: candidates.length,
        consensus_reached: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  #buildJudgePrompt(candidates: VotingCandidate[]): string {
    const lines = candidates.map((c) => `<candidate id="${c.runner_id}">\n${c.response}\n</candidate>`);
    return [
      "You are a judge evaluating responses. Select the best response.",
      "",
      ...lines,
      "",
      "Return your verdict as: WINNER: <runner_id>",
      "If you cannot determine a winner, return: TIE",
    ].join("\n");
  }

  #parseJudgeVerdict(content: string, candidates: VotingCandidate[]): VotingCandidate | null {
    const verdict = content.trim();
    if (verdict.startsWith("TIE") || verdict.startsWith("NO_CONSENSUS")) return null;
    const winnerMatch = verdict.match(/WINNER:\s*(\S+)/);
    if (!winnerMatch) return null;
    const winnerId = winnerMatch[1];
    const winner = candidates.find((c) => c.runner_id === winnerId);
    return winner ?? null;
  }

  #resolveMajority(candidates: VotingCandidate[]): VotingCandidate | null {
    if (candidates.length === 0) return null;
    const counts = new Map<string, { count: number; candidate: VotingCandidate }>();
    for (const c of candidates) {
      const key = c.response;
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
      } else {
        counts.set(key, { count: 1, candidate: c });
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
    if (sorted.length === 0) return null;
    if (sorted.length === 1) return sorted[0][1].candidate;
    return sorted[0][1].count > sorted[1][1].count ? sorted[0][1].candidate : null;
  }

  #resolveWeighted(candidates: VotingCandidate[]): VotingCandidate | null {
    if (candidates.length === 0) return null;
    const allUndefined = candidates.every((c) => c.confidence === undefined);
    if (allUndefined) return this.#resolveMajority(candidates);
    const withConfidence = candidates.map((c) => ({
      candidate: c,
      confidence: c.confidence ?? 0,
    }));
    withConfidence.sort((a, b) => b.confidence - a.confidence);
    if (withConfidence.length === 1) return withConfidence[0].candidate;
    return withConfidence[0].confidence > withConfidence[1].confidence ? withConfidence[0].candidate : null;
  }
}
