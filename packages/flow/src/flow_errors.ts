/**
 * @module FlowErrors
 * @path packages/flow/src/flow_errors.ts
 * @description The error types that a flow run throws: a failed execution and an aborted run.
 * @architectural-layer Flow
 * @related-files [packages/flow/src/flow_runner.ts, packages/flow/src/flow_step_recovery.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";
import type { IStepResult } from "./flow_types.ts";

/**
 * Error thrown when flow execution fails
 */
export class FlowExecutionError extends Error {
  get code(): string | undefined {
    return this.reasonCode;
  }
  constructor(
    message: string,
    public readonly flowRunId?: Opt<string, Reason.TraceAbsent>,
    public readonly reasonCode?: Opt<string, Reason.OptionalContext>,
  ) {
    super(message);
    this.name = "FlowExecutionError";
  }
}

export class FlowAbortError extends Error {
  constructor(
    public readonly stepId: string,
    message: string,
    public readonly flowRunId?: Opt<string, Reason.TraceAbsent>,
    public readonly failureResult?: Opt<IStepResult, Reason.OptionalContext>,
  ) {
    super(message);
    this.name = "FlowAbortError";
  }
}
