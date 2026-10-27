/**
 * @module GenerationLog
 * @path packages/execution/src/generation_log.ts
 * @description Journals one completed model generation for the agent composer, so the composer and the ReAct loop adapter write the same event.
 * @architectural-layer Execution
 * @dependencies [@exaix/core, @exaix/schemas]
 * @related-files [packages/execution/src/agent_composer.ts, packages/execution/src/react_loop_adapter.ts]
 */

import {
  ActorType,
  AGENT_COMPOSER_ID,
  AGENT_GENERATION_COMPLETED,
  DEFAULT_MCP_AGENT_ROLE_ID,
  RunnerKind,
} from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type { Opt, Reason } from "@exaix/core/types";
import type { IChangesetCostSource } from "@exaix/schemas/agent_composer.ts";

/** The token, cost and timing figures of one provider call. */
export interface IGenerationUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd?: number;
  costSource?: IChangesetCostSource;
  cacheReadTokens?: Opt<number, Reason.OptionalInput>;
  cacheCreationTokens?: Opt<number, Reason.OptionalInput>;
  /** Real wall-clock duration of this individual provider.generate() call, ms. */
  durationMs?: Opt<number, Reason.OptionalInput>;
}

/** Journals a completed generation. An unknown cost source records no cost. */
export async function logGenerationCompleted(
  logger: IEventLogger,
  traceId: string,
  agentRole: string,
  model: string,
  providerStr: string,
  usage: IGenerationUsage,
): Promise<void> {
  await logger.log({
    action: AGENT_GENERATION_COMPLETED,
    target: model,
    actor: DEFAULT_MCP_AGENT_ROLE_ID,
    actorType: ActorType.SERVICE,
    traceId,
    runnerId: AGENT_COMPOSER_ID,
    runnerKind: RunnerKind.AGENT_COMPOSER,
    agentRole,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    costUsd: usage.costSource === "unknown" ? null : usage.costUsd,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    payload: {
      model,
      provider: providerStr,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      ...(usage.costUsd === undefined ? {} : { cost_usd: usage.costUsd }),
      ...(usage.costSource === undefined ? {} : { cost_source: usage.costSource }),
      duration_ms: usage.durationMs,
    },
  });
}
