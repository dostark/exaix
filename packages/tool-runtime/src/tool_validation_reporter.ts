/**
 * @module ToolValidationReporter
 * @path packages/tool-runtime/src/tool_validation_reporter.ts
 * @description Emits distinct EventLogger events for each tool result validation
 * outcome and triggers plan amendment when policy requires it.
 * @architectural-layer Services
 * @dependencies ["packages/schemas/src/tool_result.ts", "packages/schemas/src/tool_result_remediation.ts", "packages/core/src/logger/event_logger.ts"]
 * @related-files ["packages/tool-runtime/src/tool_validation_reporter.ts", "packages/schemas/src/tool_result_remediation.ts"]
 */

import type { IEventLogger } from "@exaix/core/logger";
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
import type { Opt, Reason } from "@exaix/core/types";

export interface IValidationReportContext {
  planId?: string;
  stepId?: string;
  amendments?: IPlanAmendmentService;
  traceId?: string;
}

export const TOOL_VALIDATION_EVENT_FAIL_CLOSED = "tool.validation.fail_closed" as const;
export const TOOL_VALIDATION_EVENT_ESCALATED = "tool.validation.escalated" as const;
export const TOOL_VALIDATION_EVENT_NORMALIZATION_SUCCESS = "tool.validation.normalization_success" as const;
export const TOOL_VALIDATION_EVENT_NORMALIZATION_FAILED = "tool.validation.normalization_failed" as const;
export const TOOL_VALIDATION_EVENT_RETRY_SUCCESS = "tool.validation.retry_success" as const;
export const TOOL_VALIDATION_EVENT_RETRY_EXHAUSTED = "tool.validation.retry_exhausted" as const;

function isTerminalOutcome(outcome: IRemediationResult["outcome"]): boolean {
  return (
    outcome === REMEDIATION_OUTCOME_FAIL_CLOSED ||
    outcome === REMEDIATION_OUTCOME_RETRY_EXHAUSTED ||
    outcome === REMEDIATION_OUTCOME_NORMALIZATION_FAILED ||
    outcome === REMEDIATION_OUTCOME_ESCALATED
  );
}

export async function logValidationResult(
  toolName: string,
  policy: IToolResultRemediationPolicy,
  result: IRemediationResult,
  logger: IEventLogger,
  context?: Opt<IValidationReportContext, Reason.OptionalContext>,
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

export function createValidationEventLogger(_db?: IDatabaseService, _traceId?: string): IEventLogger {
  throw new Error(
    "createValidationEventLogger must not be called from package code. " +
      "Inject IEventLogger via constructor instead.",
  );
}

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
  return result.retriesAttempted > 0
    ? TOOL_VALIDATION_EVENT_RETRY_SUCCESS
    : TOOL_VALIDATION_EVENT_NORMALIZATION_SUCCESS;
}

function isErrorOutcome(result: IRemediationResult): boolean {
  return result.outcome === REMEDIATION_OUTCOME_FAIL_CLOSED || result.outcome === REMEDIATION_OUTCOME_RETRY_EXHAUSTED;
}
