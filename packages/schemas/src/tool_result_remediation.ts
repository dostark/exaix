/**
 * @module ToolResultRemediation
 * @path packages/schemas/src/tool_result_remediation.ts
 * @description Policy-driven remediation for tool result validation failures.
 * Implements fail_closed, escalate_only, normalize_then_validate, retry_once, and
 * retry_with_backoff remediation modes with idempotency and side-effect guards.
 * (Phase 78 Step 78.3)
 * @architectural-layer Schemas
 * @dependencies ["packages/schemas/src/tool_result.ts", "packages/schemas/src/tool_result_validator.ts", "packages/mcp/src/manifest.ts"]
 * @related-files ["src/mcp/server.ts", "src/services/tool/tool_registry.ts"]
 */

import type { JSONValue } from "@exaix/core";
import { TOOL_RESULT_VALIDATION_MAX_RETRIES } from "@exaix/core";
import { ToolSideEffectScope } from "@exaix/core";
import { TOOL_MANIFEST } from "@exaix/mcp/manifest.ts";
import {
  type IToolResultRemediationPolicy,
  type IToolResultValidationFailure,
  REMEDIATION_MODE_ESCALATE_ONLY,
  REMEDIATION_MODE_FAIL_CLOSED,
  REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
  REMEDIATION_MODE_RETRY_ONCE,
  REMEDIATION_MODE_RETRY_WITH_BACKOFF,
  ToolResultRemediationPolicySchema,
} from "./tool_result.ts";
import type { IToolResultValidator } from "./tool_result_validator.ts";

// ============================================================================
// Exported interfaces (must precede functional code — check:style requirement)
// ============================================================================

/** Possible outcomes produced by applyRemediationPolicy. */
export type IRemediationOutcome =
  | "passed"
  | "fail_closed"
  | "escalated"
  | "retry_exhausted"
  | "normalization_failed";

/** Result produced by applyRemediationPolicy. */
export interface IRemediationResult {
  outcome: IRemediationOutcome;
  /** null when outcome is "passed". */
  failure: IToolResultValidationFailure | null;
  retriesAttempted: number;
}

/** Callbacks provided by the caller for normalize and retry modes. */
export interface IRemediationContext {
  /** Transforms the raw payload before revalidation (normalize_then_validate mode). */
  normalize?: (rawResult: JSONValue) => JSONValue;
  /** Re-executes the tool to obtain a fresh result (retry_once, retry_with_backoff modes). */
  retry?: () => Promise<JSONValue>;
}

// ============================================================================
// Remediation Outcome Constants
// ============================================================================

/** Validation passed after remediation (normalize or retry succeeded). */
export const REMEDIATION_OUTCOME_PASSED = "passed" as const;
/** Mode is fail_closed — execution stopped at first validation mismatch. */
export const REMEDIATION_OUTCOME_FAIL_CLOSED = "fail_closed" as const;
/** Mode is escalate_only — failure surfaced as audit event, execution continues. */
export const REMEDIATION_OUTCOME_ESCALATED = "escalated" as const;
/** Retry attempts exhausted — validation still failing after max retries. */
export const REMEDIATION_OUTCOME_RETRY_EXHAUSTED = "retry_exhausted" as const;
/** Normalization was attempted but revalidation still failed. */
export const REMEDIATION_OUTCOME_NORMALIZATION_FAILED = "normalization_failed" as const;

export const REMEDIATION_OUTCOME_VALUES = [
  REMEDIATION_OUTCOME_PASSED,
  REMEDIATION_OUTCOME_FAIL_CLOSED,
  REMEDIATION_OUTCOME_ESCALATED,
  REMEDIATION_OUTCOME_RETRY_EXHAUSTED,
  REMEDIATION_OUTCOME_NORMALIZATION_FAILED,
] as const;

// ============================================================================
// Policy Lookup
// ============================================================================

/**
 * Looks up the remediation policy for a named tool from TOOL_MANIFEST.
 * Returns null when no manifest entry exists for the given tool name.
 */
export function lookupRemediationPolicy(toolName: string): IToolResultRemediationPolicy | null {
  const manifestEntry = TOOL_MANIFEST.find((e) => e.name === toolName);
  if (!manifestEntry) {
    return null;
  }
  return ToolResultRemediationPolicySchema.parse({
    tool: toolName,
    mode: manifestEntry.remediationPolicyRef ?? REMEDIATION_MODE_FAIL_CLOSED,
    maxRetries: 0,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
  });
}

// ============================================================================
// Idempotency / Side-Effect Guard
// ============================================================================

function canRetryTool(toolName: string, policy: IToolResultRemediationPolicy): boolean {
  const manifestEntry = TOOL_MANIFEST.find((e) => e.name === toolName);
  if (!manifestEntry) {
    return false;
  }
  if (policy.requiresIdempotency && !manifestEntry.idempotent) {
    return false;
  }
  if (!policy.allowRetryAfterSideEffect && manifestEntry.side_effect_scope !== ToolSideEffectScope.NONE) {
    return false;
  }
  return true;
}

// ============================================================================
// Remediation Dispatch
// ============================================================================

/**
 * Applies the remediation policy for a validation failure.
 *
 * - fail_closed: stops immediately and returns the failure.
 * - escalate_only: surfaces the failure as an audit event without stopping execution.
 * - normalize_then_validate: calls context.normalize() then revalidates the payload.
 * - retry_once: retries once using context.retry() if the tool allows it.
 * - retry_with_backoff: retries up to policy.maxRetries times using context.retry().
 *
 * Retry is blocked when idempotency or side-effect constraints are violated.
 */
export async function applyRemediationPolicy(
  toolName: string,
  policy: IToolResultRemediationPolicy,
  validationFailure: IToolResultValidationFailure,
  validator: IToolResultValidator,
  context?: IRemediationContext,
): Promise<IRemediationResult> {
  switch (policy.mode) {
    case REMEDIATION_MODE_FAIL_CLOSED:
      return { outcome: REMEDIATION_OUTCOME_FAIL_CLOSED, failure: validationFailure, retriesAttempted: 0 };

    case REMEDIATION_MODE_ESCALATE_ONLY:
      return { outcome: REMEDIATION_OUTCOME_ESCALATED, failure: validationFailure, retriesAttempted: 0 };

    case REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE: {
      if (!context?.normalize) {
        return {
          outcome: REMEDIATION_OUTCOME_NORMALIZATION_FAILED,
          failure: validationFailure,
          retriesAttempted: 0,
        };
      }
      const rawResult = validationFailure.rawResult as JSONValue;
      const normalized = context.normalize(rawResult);
      const revalidated = validator.validateEnvelope(toolName, normalized);
      if (revalidated === null) {
        return { outcome: REMEDIATION_OUTCOME_PASSED, failure: null, retriesAttempted: 0 };
      }
      return { outcome: REMEDIATION_OUTCOME_NORMALIZATION_FAILED, failure: revalidated, retriesAttempted: 0 };
    }

    case REMEDIATION_MODE_RETRY_ONCE: {
      if (!canRetryTool(toolName, policy) || !context?.retry) {
        return { outcome: REMEDIATION_OUTCOME_FAIL_CLOSED, failure: validationFailure, retriesAttempted: 0 };
      }
      const retryResult = await context.retry();
      const retryFailure = validator.validateEnvelope(toolName, retryResult);
      if (retryFailure === null) {
        return { outcome: REMEDIATION_OUTCOME_PASSED, failure: null, retriesAttempted: 1 };
      }
      return { outcome: REMEDIATION_OUTCOME_RETRY_EXHAUSTED, failure: retryFailure, retriesAttempted: 1 };
    }

    case REMEDIATION_MODE_RETRY_WITH_BACKOFF: {
      if (!canRetryTool(toolName, policy) || !context?.retry) {
        return { outcome: REMEDIATION_OUTCOME_FAIL_CLOSED, failure: validationFailure, retriesAttempted: 0 };
      }
      const maxRetries = Math.min(policy.maxRetries, TOOL_RESULT_VALIDATION_MAX_RETRIES);
      let lastFailure = validationFailure;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const retryResult = await context.retry();
        const retryFailure = validator.validateEnvelope(toolName, retryResult);
        if (retryFailure === null) {
          return { outcome: REMEDIATION_OUTCOME_PASSED, failure: null, retriesAttempted: attempt + 1 };
        }
        lastFailure = retryFailure;
      }
      return { outcome: REMEDIATION_OUTCOME_RETRY_EXHAUSTED, failure: lastFailure, retriesAttempted: maxRetries };
    }
  }
}
