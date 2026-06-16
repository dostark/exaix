/**
 * @module VotingConsensusService
 * @path packages/voting/src/voting_consensus_service.ts
 * @ungrounded
 * @description Concensus resolution service for voting_group flow steps.
 * Fans out N runners, collects candidates, and resolves majority/weighted consensus.
 * @architectural-layer Voting
 * @dependencies [packages/voting/src/i_executor.ts, packages/voting/src/i_voting_consensus_service.ts]
 * @related-files [packages/schemas/src/voting.ts, packages/core/src/events/domain_event_types.ts]
 */

import type {
  VotingCandidate,
  VotingGroupConfig,
  VotingResult,
} from "@exaix/schemas/voting.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import { VotingStrategy } from "@exaix/core/types";
import type { IExecutor } from "./i_executor.ts";
import type { IVotingConsensusService } from "./i_voting_consensus_service.ts";

export class VotingConsensusService implements IVotingConsensusService {
  #executor: IExecutor;
  #logger: IEventLogger;

  constructor(executor: IExecutor, logger: IEventLogger) {
    this.#executor = executor;
    this.#logger = logger;
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
      const result: VotingResult = {
        trace_id: traceId,
        strategy: config.strategy,
        winner: { runner_id: "", response: "" },
        candidates,
        consensus_reached: false,
        dissent_summary: "All runners failed",
      };
      await this.#logger.info(DomainEventType.VotingNoConsensus, traceId, {
        step_id: traceId,
        strategy: config.strategy,
        candidate_count: 0,
        consensus_reached: false,
        dissent_summary: result.dissent_summary,
      });
      return result;
    }

    const winner = config.strategy === VotingStrategy.WEIGHTED
      ? this.#resolveWeighted(candidates)
      : this.#resolveMajority(candidates);

    if (!winner) {
      const result = this.#buildNoConsensusResult(
        traceId,
        config.strategy,
        candidates,
      );
      await this.#logger.info(DomainEventType.VotingNoConsensus, traceId, {
        step_id: traceId,
        strategy: config.strategy,
        candidate_count: candidates.length,
        consensus_reached: false,
        dissent_summary: result.dissent_summary,
      });
      return result;
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

  #resolveMajority(candidates: VotingCandidate[]): VotingCandidate | null {
    if (candidates.length === 0) return null;
    const counts = new Map<
      string,
      { count: number; candidate: VotingCandidate }
    >();
    for (const c of candidates) {
      const key = c.response;
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
      } else {
        counts.set(key, { count: 1, candidate: c });
      }
    }
    const sorted = [...counts.entries()].sort((a, b) =>
      b[1].count - a[1].count
    );
    if (sorted.length === 0) return null;
    if (sorted.length === 1) return sorted[0][1].candidate;
    return sorted[0][1].count > sorted[1][1].count
      ? sorted[0][1].candidate
      : null;
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
    return withConfidence[0].confidence > withConfidence[1].confidence
      ? withConfidence[0].candidate
      : null;
  }

  #buildNoConsensusResult(
    traceId: string,
    strategy: VotingStrategy,
    candidates: VotingCandidate[],
  ): VotingResult {
    const maxConfidence = candidates.reduce(
      (best, c) => (c.confidence ?? 0) > (best.confidence ?? 0) ? c : best,
      candidates[0],
    );
    return {
      trace_id: traceId,
      strategy,
      winner: maxConfidence,
      candidates,
      consensus_reached: false,
      dissent_summary:
        `No consensus reached among ${candidates.length} candidate(s)`,
    };
  }
}
