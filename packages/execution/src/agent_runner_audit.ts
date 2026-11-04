/**
 * @module AgentRunnerAudit
 * @path packages/execution/src/agent_runner_audit.ts
 * @description The journal rows of one agent run: start, retry attempts, truncated or refused answers, failure and completion.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_runner.ts, packages/execution/tests/agent_runner_provider_retry_test.ts]
 */

import type { IGenerateResult } from "@exaix/ai/providers";
import { toSafeJson } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import {
  AGENT_EVENT_EXECUTION_COMPLETED,
  AGENT_EVENT_EXECUTION_STARTED,
  AGENT_EVENT_RESPONSE_REFUSED,
  AGENT_EVENT_RESPONSE_TRUNCATED,
  DEFAULT_UNKNOWN_ERROR_MESSAGE,
  DEFAULT_UNKNOWN_LABEL,
  RESPONSE_STOP_REASON_MAX_TOKENS,
  RESPONSE_STOP_REASON_REFUSAL,
} from "@exaix/core";
import type { IRetryContext, IRetryResult } from "@exaix/core/request";
import type { Opt, Reason } from "@exaix/core/types";
import type { IParsedRequest } from "./agent_runner.ts";

/** What the lifecycle audit of one runner needs from it. */
interface IAgentRunnerAuditDependencies {
  readonly logger: Opt<IEventLogger, Reason.OptionalDependency>;
  readonly retryEnabled: boolean;
  readonly skillsEnabled: boolean;
  readonly journal: (
    action: string,
    target: string | null,
    payload: Record<string, JSONValue>,
    traceId?: Opt<string, Reason.TraceAbsent>,
    agentRole?: Opt<string | null, Reason.OptionalContext>,
  ) => void;
}

/** The journal rows of one agent run: its start, retry attempts, truncated or refused answers, failure and completion. */
export class AgentRunnerAudit {
  private readonly logger: IAgentRunnerAuditDependencies["logger"];
  private readonly retryEnabled: boolean;
  private readonly skillsEnabled: boolean;
  private readonly journal: IAgentRunnerAuditDependencies["journal"];

  constructor(dependencies: IAgentRunnerAuditDependencies) {
    this.logger = dependencies.logger;
    this.retryEnabled = dependencies.retryEnabled;
    this.skillsEnabled = dependencies.skillsEnabled;
    this.journal = dependencies.journal;
  }

  /** Logs one provider retry attempt. */
  logRetryAttempt(ctx: IRetryContext): void {
    this.journal(
      "agent.retry_attempt",
      null,
      {
        attempt: ctx.attempt,
        delay_ms: ctx.delayMs,
        temperature: ctx.temperature,
        elapsed_ms: ctx.elapsedMs,
        error_type: ctx.error.constructor.name,
        error_message: ctx.error.message,
      },
    );
  }

  /**
   * Log the start of agent execution
   */
  logExecutionStart(
    request: IParsedRequest,
    agentRole: string,
    traceId: Opt<string, Reason.TraceAbsent>,
    requestId: Opt<string, Reason.TraceAbsent>,
    skillsApplied: string[],
  ): void {
    this.journal(
      AGENT_EVENT_EXECUTION_STARTED,
      requestId || null,
      {
        agent_role: agentRole,
        prompt_length: request.userPrompt.length,
        has_context: Object.keys(request.context).length > 0,
        retry_enabled: this.retryEnabled,
        skills_enabled: this.skillsEnabled,
        skills_matched: skillsApplied.length,
        skills_applied: skillsApplied,
      },
      traceId,
      agentRole,
    );
  }

  /**
   * Handle execution failure by logging and throwing
   */
  handleExecutionFailure(
    retryResult: IRetryResult<IGenerateResult>,
    requestId: Opt<string, Reason.TraceAbsent>,
    agentRole: string,
    traceId: Opt<string, Reason.TraceAbsent>,
    duration: number,
  ): never {
    this.journal(
      "agent.execution_failed",
      requestId || null,
      {
        agent_role: agentRole,
        duration_ms: duration,
        total_attempts: retryResult.totalAttempts,
        retry_history: toSafeJson(retryResult.retryHistory),
        error_type: retryResult.error?.constructor.name || DEFAULT_UNKNOWN_LABEL,
        error_message: retryResult.error?.message || DEFAULT_UNKNOWN_ERROR_MESSAGE,
      },
      traceId,
      agentRole,
    );

    throw retryResult.error || new Error("Agent execution failed after retries");
  }

  /**
   * Log successful execution completion
   */
  logExecutionCompletion(args: {
    result: { thought: string; content: string };
    rawResponse: string;
    retryResult: IRetryResult<IGenerateResult>;
    requestId: string | undefined;
    agentRole: string;
    traceId: string | undefined;
    duration: number;
    skillsApplied: string[];
  }): void {
    const {
      result,
      rawResponse,
      retryResult,
      requestId,
      agentRole,
      traceId,
      duration,
      skillsApplied,
    } = args;
    this.journal(
      AGENT_EVENT_EXECUTION_COMPLETED,
      requestId || null,
      {
        agent_role: agentRole,
        duration_ms: duration,
        total_attempts: retryResult.totalAttempts,
        retry_history: retryResult.retryHistory.length > 0 ? toSafeJson(retryResult.retryHistory) : null,
        response_length: rawResponse?.length || 0,
        has_thought: result.thought.length > 0,
        has_content: result.content.length > 0,
        skills_applied: skillsApplied.length > 0 ? toSafeJson(skillsApplied) : null,
      },
      traceId,
      agentRole,
    );
  }

  /** A truncated or refused answer is journaled as a warning, so the parse failure that follows is attributable to it. */
  warnOnStopReason(
    generateResult: Opt<IGenerateResult, Reason.OptionalInput>,
    rawResponse: string,
    agentRole: string,
    requestId: Opt<string, Reason.TraceAbsent>,
    traceId: Opt<string, Reason.TraceAbsent>,
  ): void {
    if (!this.logger || !generateResult) return;
    if (generateResult.stop_reason === RESPONSE_STOP_REASON_MAX_TOKENS) {
      void this.logger.warn(AGENT_EVENT_RESPONSE_TRUNCATED, requestId || null, {
        agent_role: agentRole,
        stop_reason: generateResult.stop_reason,
        response_length: rawResponse.length,
        completion_tokens: generateResult.usage?.completionTokens ?? null,
      }, traceId);
    }
    if (generateResult.stop_reason === RESPONSE_STOP_REASON_REFUSAL) {
      void this.logger.warn(AGENT_EVENT_RESPONSE_REFUSED, requestId || null, {
        agent_role: agentRole,
        stop_reason: generateResult.stop_reason,
        response_length: rawResponse.length,
      }, traceId);
    }
  }
}
