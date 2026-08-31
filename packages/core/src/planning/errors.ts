/**
 * @module PlanAmendmentErrors
 * @path packages/core/src/planning/errors.ts
 * @description Custom error types for the plan amendment lifecycle and guardrail blocking.
 * @architectural-layer Services
 * @related-files [packages/core/src/planning/plan_executor.ts, packages/execution/src/execution_loop.ts]
 */

/**
 * Thrown when an execution plan enters a pending amendment state.
 * This error is used to signal the execution loop to pause and wait for user approval.
 */
export class PlanAmendmentPendingError extends Error {
  constructor(
    public readonly planId: string,
    public readonly amendmentId: string,
    message: string,
  ) {
    super(message);
    this.name = "PlanAmendmentPendingError";
  }
}

/** Caught by PlanExecutor to trigger an amendment with source "guardrail_violation". */
export class GuardrailBlockedError extends Error {
  constructor(
    public readonly traceId: string,
    message: string,
  ) {
    super(message);
    this.name = "GuardrailBlockedError";
  }
}
