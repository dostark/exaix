/**
 * @module FlowControlErrors
 * @path packages/flow/src/errors/flow_control_errors.ts
 * @description Terminal gate errors and action-to-result mapping.
 * @architectural-layer Flows
 * @dependencies [@exaix/core, @exaix/execution]
 * @related-files [packages/flow/src/step_handlers/gate_step_handler.ts, packages/flow/src/wave_orchestrator.ts]
 */
import { FlowGateAction } from "@exaix/core";
import type { IGateResult, Opt, Reason } from "@exaix/core/types";
import type { IAgentExecutionResult } from "@exaix/execution";

export const FLOW_GATE_HALTED_CODE = "gate_halted";
export const FLOW_CONTROL_RESUME_UNSUPPORTED_CODE = "flow_control_resume_unsupported";
export const FLOW_GATE_EVALUATION_LIMIT_CODE = "gate_evaluation_limit";
export const FLOW_RETRY_BUDGET_UNAVAILABLE_CODE = "flow_retry_budget_unavailable";
export const FLOW_RETRY_BUDGET_EXCEEDED_CODE = "flow_retry_budget_exceeded";
export const GATE_LOOP_BODY_FAILED_CODE = "gate_loop_body_failed";
export const GATE_LOOP_BODY_SKIPPED_CODE = "gate_loop_body_skipped";
export const GATE_RETRY_REQUIRES_RUNNER_CODE = "gate_retry_requires_runner";
export const BRANCH_OUTPUT_UNPARSEABLE_CODE = "branch_output_unparseable";
export const BRANCH_CONDITION_ERROR_CODE = "branch_condition_error";
export const BRANCH_NO_MATCH_CODE = "branch_no_match";
export class FlowControlError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "FlowControlError";
  }
}
export function isTerminalFlowControlCode(code: Opt<string, Reason.OptionalContext>): boolean {
  return code !== undefined &&
    [
      FLOW_GATE_HALTED_CODE,
      FLOW_GATE_EVALUATION_LIMIT_CODE,
      FLOW_CONTROL_RESUME_UNSUPPORTED_CODE,
      FLOW_RETRY_BUDGET_UNAVAILABLE_CODE,
      FLOW_RETRY_BUDGET_EXCEEDED_CODE,
      GATE_LOOP_BODY_FAILED_CODE,
      GATE_LOOP_BODY_SKIPPED_CODE,
      GATE_RETRY_REQUIRES_RUNNER_CODE,
      BRANCH_OUTPUT_UNPARSEABLE_CODE,
      BRANCH_CONDITION_ERROR_CODE,
      BRANCH_NO_MATCH_CODE,
    ].includes(code);
}
export class FlowGateHaltedError extends Error {
  readonly code = FLOW_GATE_HALTED_CODE;
  constructor(
    public readonly stepId: string,
    public readonly score: number,
    public readonly threshold: number,
    public readonly feedback: string,
  ) {
    super(`Gate ${stepId} halted: score ${score} below threshold ${threshold}. ${feedback}`);
    this.name = "FlowGateHaltedError";
  }
}
/** Converts a settled gate evaluation into the registry result contract. */
export function gateEvaluationResult(stepId: string, threshold: number, result: IGateResult): IAgentExecutionResult {
  if (result.action === FlowGateAction.RETRY) {
    throw new FlowControlError(GATE_RETRY_REQUIRES_RUNNER_CODE, `Gate '${stepId}' retry requires FlowRunner`);
  }
  if (result.action !== FlowGateAction.PASSED && result.action !== FlowGateAction.CONTINUED_WITH_WARNING) {
    throw new FlowGateHaltedError(stepId, result.score, threshold, result.evaluation.feedback);
  }
  return { thought: "", content: result.evaluation.feedback, raw: JSON.stringify(result.evaluation) };
}
