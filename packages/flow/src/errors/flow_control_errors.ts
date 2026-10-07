/**
 * @module FlowControlErrors
 * @path packages/flow/src/errors/flow_control_errors.ts
 * @description Terminal gate errors and action-to-result mapping.
 * @architectural-layer Flows
 * @dependencies [@exaix/core, @exaix/execution]
 * @related-files [packages/flow/src/step_handlers/gate_step_handler.ts, packages/flow/src/wave_orchestrator.ts]
 */
import { FlowGateAction } from "@exaix/core";
import type { IGateResult } from "@exaix/core/types";
import type { IAgentExecutionResult } from "@exaix/execution";

export const FLOW_GATE_HALTED_CODE = "gate_halted";
export const FLOW_CONTROL_RESUME_UNSUPPORTED_CODE = "flow_control_resume_unsupported";
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
  if (result.action !== FlowGateAction.PASSED && result.action !== FlowGateAction.CONTINUED_WITH_WARNING) {
    throw new FlowGateHaltedError(stepId, result.score, threshold, result.evaluation.feedback);
  }
  return { thought: "", content: result.evaluation.feedback, raw: JSON.stringify(result.evaluation) };
}
