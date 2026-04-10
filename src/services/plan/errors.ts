/**
 * @module PlanAmendmentErrors
 * @path src/services/plan/errors.ts
 * @description Custom error types for the plan amendment lifecycle.
 * @architectural-layer Services
 * @related-files [src/services/plan/plan_executor.ts, src/services/agent/execution_loop.ts]
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
