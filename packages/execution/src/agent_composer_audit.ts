/**
 * @module AgentComposerAudit
 * @path packages/execution/src/agent_composer_audit.ts
 * @description The journal rows of one composed agent step: start, completion with its usage, and failure.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_composer.ts, packages/execution/tests/agent_orchestrator_journal_test.ts]
 */

import type { IEventLogger } from "@exaix/core/logger";
import { ActorType, LogLevel, RunnerKind } from "@exaix/core";
import {
  AGENT_COMPOSER_ID,
  AGENT_EVENT_EXECUTION_COMPLETED,
  AGENT_EVENT_EXECUTION_FAILED,
  AGENT_EVENT_EXECUTION_STARTED,
} from "@exaix/core";
import { DEFAULT_MCP_AGENT_ROLE_ID } from "@exaix/core/types";
import type { IChangesetCostSource, IChangesetResult } from "@exaix/schemas/agent_composer.ts";
import type { Opt, Reason } from "@exaix/core/types";

/** The real usage block one strategy may report. */
export type IComposerUsage = {
  tokens: number;
  cost_usd_estimate: number | null;
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  reasoning_tokens?: number;
  cost_source?: IChangesetCostSource;
};

/** What the execution audit of one composer needs from it. */
interface IAgentComposerAuditDependencies {
  readonly logger: IEventLogger;
  readonly estimateTokens: (text: string) => number;
}

/** The journal rows of one composed step: its start, completion and failure. */
export class AgentComposerAudit {
  private readonly logger: IEventLogger;
  private readonly estimateTokens: (text: string) => number;

  constructor(dependencies: IAgentComposerAuditDependencies) {
    this.logger = dependencies.logger;
    this.estimateTokens = dependencies.estimateTokens;
  }

  /**
   * Validate review result structure
   */
  /**
   * Log execution start to IActivity Journal
   */
  async logExecutionStart(
    traceId: string,
    agentRole: string,
    portal: string,
  ): Promise<void> {
    await this.logger.log({
      action: AGENT_EVENT_EXECUTION_STARTED,
      target: portal,
      actor: DEFAULT_MCP_AGENT_ROLE_ID,
      actorType: ActorType.SERVICE,
      traceId: traceId,
      runnerId: AGENT_COMPOSER_ID,
      runnerKind: RunnerKind.AGENT_COMPOSER,
      agentRole: agentRole,
      payload: {
        portal,
        started_at: new Date().toISOString(),
      },
    });
  }

  /**
   * Log execution completion to IActivity Journal
   */
  async logExecutionComplete(
    traceId: string,
    agentRole: string,
    result: IChangesetResult,
    usage?: Opt<IComposerUsage, Reason.OptionalInput>,
    /** Real per-step wall-clock duration around executeStep, distinct from the
     *  strategy-internal execution_time_ms already on `result`. */
    durationMs?: Opt<number, Reason.OptionalInput>,
  ): Promise<void> {
    const usagePayload = usage ?? {
      tokens: Math.max(1, this.estimateTokens(result.description)),
      cost_usd_estimate: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      // No strategy reported usage, so the cost source defaults to predicted.
      cost_source: "predicted" as const,
    };

    await this.logger.log({
      action: AGENT_EVENT_EXECUTION_COMPLETED,
      target: result.branch,
      actor: DEFAULT_MCP_AGENT_ROLE_ID,
      actorType: ActorType.SERVICE,
      traceId: traceId,
      runnerId: AGENT_COMPOSER_ID,
      runnerKind: RunnerKind.AGENT_COMPOSER,
      agentRole: agentRole,
      promptTokens: usagePayload.prompt_tokens ?? Math.floor(usagePayload.tokens / 2),
      completionTokens: usagePayload.completion_tokens ?? Math.ceil(usagePayload.tokens / 2),
      costUsd: usagePayload.cost_usd_estimate,
      cacheReadTokens: usagePayload.cache_read_tokens,
      cacheCreationTokens: usagePayload.cache_creation_tokens,
      payload: {
        branch: result.branch,
        commit_sha: result.commit_sha,
        files_changed: result.files_changed.length,
        tool_calls: result.tool_calls,
        execution_time_ms: result.execution_time_ms,
        duration_ms: durationMs,
        usage: usagePayload,
        completed_at: new Date().toISOString(),
      },
    });
  }

  /**
   * Log execution error to IActivity Journal
   */
  async logExecutionError(
    traceId: string,
    agentRole: string,
    error: { type: string; message: string; trace_id?: string; providerReasonCode?: string },
  ): Promise<void> {
    await this.logger.log({
      action: AGENT_EVENT_EXECUTION_FAILED,
      target: agentRole,
      actor: DEFAULT_MCP_AGENT_ROLE_ID,
      actorType: ActorType.SERVICE,
      traceId: traceId,
      runnerId: AGENT_COMPOSER_ID,
      runnerKind: RunnerKind.AGENT_COMPOSER,
      agentRole: agentRole,
      level: LogLevel.ERROR,
      payload: {
        error_type: error.type,
        error_message: error.message,
        ...(error.providerReasonCode ? { providerReasonCode: error.providerReasonCode } : {}),
        failed_at: new Date().toISOString(),
      },
    });
  }
}
