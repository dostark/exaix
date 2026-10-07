/**
 * @module GateLoopCoordinator
 * @path packages/flow/src/gate_loop_coordinator.ts
 * @description Executes admitted sequential retry iterations through runner callbacks.
 * @architectural-layer Flows
 * @dependencies [@exaix/core]
 * @related-files [packages/flow/src/flow_runner.ts]
 */
import { FlowGateAction } from "@exaix/core";
import type { IGateResult, Opt, Reason } from "@exaix/core/types";
import type { IStepResult } from "./flow_runner.ts";
import {
  FLOW_GATE_EVALUATION_LIMIT_CODE,
  FlowControlError,
  GATE_LOOP_BODY_FAILED_CODE,
  GATE_LOOP_BODY_SKIPPED_CODE,
} from "./errors/flow_control_errors.ts";
export interface IGateLoopCallbacks {
  evaluate(attempt: number): Promise<IGateResult>;
  admit(iteration: number, verdict: IGateResult): Promise<void>;
  runMember(id: string, iteration: number, feedback: Opt<string, Reason.OptionalContext>): Promise<IStepResult>;
  finalize(result: IStepResult): Promise<void>;
  invalidate(): void;
}
/** Runs bounded evaluations with sequential, gate-owned body iterations. */
export async function runGateLoop(
  bodyIds: string[],
  backTo: Opt<string, Reason.OptionalContext>,
  maxRetries: number,
  callbacks: IGateLoopCallbacks,
): Promise<IGateResult> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const verdict = await callbacks.evaluate(attempt);
    if (verdict.action !== FlowGateAction.RETRY) return verdict;
    if (attempt === maxRetries) {
      throw new FlowControlError(
        FLOW_GATE_EVALUATION_LIMIT_CODE,
        "Gate evaluator returned retry after its evaluation limit",
      );
    }
    await callbacks.admit(attempt, verdict);
    callbacks.invalidate();
    for (const id of bodyIds) {
      await executeBodyMember(id, attempt, id === backTo ? verdict.evaluation.feedback : undefined, callbacks);
    }
  }
  throw new Error("Gate loop has no available evaluations");
}

async function executeBodyMember(
  id: string,
  iteration: number,
  feedback: Opt<string, Reason.OptionalContext>,
  callbacks: IGateLoopCallbacks,
): Promise<void> {
  try {
    const result = await callbacks.runMember(id, iteration, feedback);
    if (!result.success || result.skipped) {
      throw new FlowControlError(
        result.skipped ? GATE_LOOP_BODY_SKIPPED_CODE : GATE_LOOP_BODY_FAILED_CODE,
        `Gate loop body '${id}' did not complete: ${result.error ?? result.skipReason ?? ""}`,
      );
    }
    await callbacks.finalize(result);
  } catch (error) {
    if (error instanceof FlowControlError) throw error;
    throw new FlowControlError(
      GATE_LOOP_BODY_FAILED_CODE,
      `Gate loop body '${id}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
