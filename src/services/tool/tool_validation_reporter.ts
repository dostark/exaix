/**
 * @module ToolValidationReporter
 * @path src/services/tool/tool_validation_reporter.ts
 * @description Emits distinct EventLogger events for each tool result validation
 * outcome and triggers plan amendment when policy requires it.
 * (Phase 78 Step 78.4)
 * @architectural-layer Services
 * @dependencies ["packages/schemas/src/tool_result.ts", "packages/schemas/src/tool_result_remediation.ts", "packages/core/src/logger/event_logger.ts"]
 * @related-files ["src/services/tool/tool_validation_reporter.ts", "packages/schemas/src/tool_result_remediation.ts"]
 */

import { EventLogger, type IEventLogger } from "@exaix/core/logger/event_logger.ts";
import { LogLevel } from "@exaix/core";
import type { IDatabaseService, IPlanAmendmentService } from "@exaix/core/types";
import type { IToolResultRemediationPolicy } from "@exaix/schemas/tool_result.ts";
import type { IRemediationResult } from "@exaix/schemas/tool_result_remediation.ts";
import {
  REMEDIATION_OUTCOME_ESCALATED,
  REMEDIATION_OUTCOME_FAIL_CLOSED,
  REMEDIATION_OUTCOME_NORMALIZATION_FAILED,
  REMEDIATION_OUTCOME_RETRY_EXHAUSTED,
} from "@exaix/schemas/tool_result_remediation.ts";

// ============================================================================
// Exported interfaces (must precede functional code — check:style requirement)
// ============================================================================

/** Optional context for plan amendment integration in logValidationResult. */
export interface IValidationReportContext {
  /** Plan identifier passed to IPlanAmendmentService.shouldAmend(). */
  planId?: string;
  /** Step identifier passed to IPlanAmendmentService.shouldAmend(). */
  stepId?: string;
  /** Plan amendment service; when present and policy requires it, shouldAmend() is called on terminal outcomes. */
  amendments?: IPlanAmendmentService;
  /** Optional trace ID forwarded to EventLogger events. */
  traceId?: string;
}

// ============================================================================
// Event Action Constants
// ============================================================================

/** Tool result payload did not match the declared output schema; no remediation succeeded. */
export const TOOL_VALIDATION_EVENT_FAIL_CLOSED = "tool.validation.fail_closed" as const;
/** Tool result payload mismatch surfaced as audit event; execution continues. */
export const TOOL_VALIDATION_EVENT_ESCALATED = "tool.validation.escalated" as const;
/** Normalization transform fixed the payload and revalidation passed. */
export const TOOL_VALIDATION_EVENT_NORMALIZATION_SUCCESS = "tool.validation.normalization_success" as const;
/** Normalization transform was applied but revalidation still failed. */
export const TOOL_VALIDATION_EVENT_NORMALIZATION_FAILED = "tool.validation.normalization_failed" as const;
/** Retry re-execution produced a valid result; remediation succeeded. */
export const TOOL_VALIDATION_EVENT_RETRY_SUCCESS = "tool.validation.retry_success" as const;
/** All retry attempts exhausted; tool result still fails schema validation. */
export const TOOL_VALIDATION_EVENT_RETRY_EXHAUSTED = "tool.validation.retry_exhausted" as const;

// ============================================================================
// Terminal outcome check (determines whether plan amendment is triggered)
// ============================================================================

function isTerminalOutcome(outcome: IRemediationResult["outcome"]): boolean {
  return (
    outcome === REMEDIATION_OUTCOME_FAIL_CLOSED ||
    outcome === REMEDIATION_OUTCOME_RETRY_EXHAUSTED ||
    outcome === REMEDIATION_OUTCOME_NORMALIZATION_FAILED ||
    outcome === REMEDIATION_OUTCOME_ESCALATED
  );
}

// ============================================================================
// Reporter
// ============================================================================

/**
 * Emits a distinct EventLogger event for a completed remediation cycle, and
 * optionally triggers plan amendment when the policy requires it and the
 * outcome is terminal.
 *
 * No events are emitted when policy.logValidationFailures is false.
 * Plan amendment is attempted only when policy.triggerPlanAmendmentOnFailure
 * is true, the outcome is terminal, and context.amendments is provided.
 */
export async function logValidationResult(
  toolName: string,
  policy: IToolResultRemediationPolicy,
  result: IRemediationResult,
  logger: IEventLogger,
  context?: IValidationReportContext,
): Promise<void> {
  if (policy.logValidationFailures) {
    const action = resolveEventAction(result);
    const level = isErrorOutcome(result) ? LogLevel.ERROR : LogLevel.INFO;
    await logger.log({
      action,
      target: toolName,
      level,
      traceId: context?.traceId,
      payload: {
        metricName: action,
        metricValue: 1,
        outcome: result.outcome,
        policyMode: policy.mode,
        retriesAttempted: result.retriesAttempted,
        ...(result.failure ? { validationStage: result.failure.stage } : {}),
        ...(result.failure ? { issueCount: result.failure.issues.length } : {}),
      },
    });
  }

  if (
    policy.triggerPlanAmendmentOnFailure && isTerminalOutcome(result.outcome) && context?.amendments && context.stepId
  ) {
    await context.amendments.shouldAmend({
      source: "tool_error",
      stepId: context.stepId,
      reason: `Tool '${toolName}' result validation failed: outcome=${result.outcome}`,
      toolName,
    });
  }
}

export function createValidationEventLogger(db?: IDatabaseService, traceId?: string): IEventLogger {
  return new EventLogger({ db, minLevel: LogLevel.DEBUG }, traceId ? { traceId } : {});
}

// ============================================================================
// Private helpers
// ============================================================================

function resolveEventAction(result: IRemediationResult): string {
  if (result.outcome === REMEDIATION_OUTCOME_FAIL_CLOSED) {
    return TOOL_VALIDATION_EVENT_FAIL_CLOSED;
  }
  if (result.outcome === REMEDIATION_OUTCOME_ESCALATED) {
    return TOOL_VALIDATION_EVENT_ESCALATED;
  }
  if (result.outcome === REMEDIATION_OUTCOME_RETRY_EXHAUSTED) {
    return TOOL_VALIDATION_EVENT_RETRY_EXHAUSTED;
  }
  if (result.outcome === REMEDIATION_OUTCOME_NORMALIZATION_FAILED) {
    return TOOL_VALIDATION_EVENT_NORMALIZATION_FAILED;
  }
  // outcome === "passed"
  return result.retriesAttempted > 0
    ? TOOL_VALIDATION_EVENT_RETRY_SUCCESS
    : TOOL_VALIDATION_EVENT_NORMALIZATION_SUCCESS;
}

function isErrorOutcome(result: IRemediationResult): boolean {
  return result.outcome === REMEDIATION_OUTCOME_FAIL_CLOSED || result.outcome === REMEDIATION_OUTCOME_RETRY_EXHAUSTED;
}
