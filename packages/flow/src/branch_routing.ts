/**
 * @module BranchRouting
 * @path packages/flow/src/branch_routing.ts
 * @description Determines branch skip propagation without changing condition skip behavior.
 * @architectural-layer Flows
 * @dependencies [@exaix/schemas]
 * @related-files [packages/flow/src/flow_runner.ts]
 */
import type { IFlowStep } from "@exaix/schemas/flow.ts";
import type { IStepResult } from "./flow_runner.ts";
import type { IFlowControlState } from "./contracts/flow_control_state.ts";
import { resolveAggregateSources } from "./flow_runner.ts";
import { FlowInputSource, FlowStepSkipCode } from "@exaix/core";

export function branchSkipReason(
  step: IFlowStep,
  results: Map<string, IStepResult>,
  state: IFlowControlState,
): string | null {
  if (Object.values(state.branches).some((branch) => branch.decision.notTaken.includes(step.id))) {
    return "Branch target was not taken";
  }
  const isSkipped = (id: string) => results.get(id)?.skipCode === FlowStepSkipCode.BRANCH_NOT_TAKEN;
  if (step.dependsOn.length > 0 && step.dependsOn.every(isSkipped)) return "All dependencies were branch-skipped";
  if (step.input.source === FlowInputSource.STEP && step.input.stepId && isSkipped(step.input.stepId)) {
    return "Input source was branch-skipped";
  }
  const sources = step.input.source === FlowInputSource.AGGREGATE ? resolveAggregateSources(step) : [];
  if (sources.length > 0 && sources.every(isSkipped)) return "All aggregate sources were branch-skipped";
  return null;
}
