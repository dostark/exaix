/**
 * @module LoopBody
 * @path packages/flow/src/loop_body.ts
 * @description Selects dependency paths and validates gate-owned retry bodies.
 * @architectural-layer Flows
 * @dependencies [@exaix/core, @exaix/schemas, ./dependency_resolver.ts]
 * @related-files [packages/flow/src/flow_runtime_validator.ts]
 */
import { ExecutionStrategyName, FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import { DependencyResolver } from "./dependency_resolver.ts";

/** Selects every dependency path from the loop entry to its gate. */
export function computeLoopBody(flow: IFlow, gate: IFlowStep): string[] {
  const backTo = gate.loop?.backTo ?? gate.input.stepId;
  if (!backTo || backTo === gate.id) return [];
  const ancestors = new Set<string>();
  const pending = [...gate.dependsOn];
  while (pending.length) {
    const id = pending.pop()!;
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    pending.push(...(flow.steps.find((step) => step.id === id)?.dependsOn ?? []));
  }
  const descendants = new Set([backTo]);
  const order = new DependencyResolver(flow.steps).topologicalSort();
  for (const id of order) {
    const step = flow.steps.find((entry) => entry.id === id)!;
    if (step.dependsOn.some((dependency) => descendants.has(dependency))) descendants.add(id);
  }
  return order.filter((id) => id !== gate.id && ancestors.has(id) && descendants.has(id));
}

/** Rejects unsupported effects and consumers outside a gate's retry boundary. */
export function validateLoopBody(flow: IFlow, gate: IFlowStep): string | null {
  const ids = computeLoopBody(flow, gate);
  if (!ids.length) return `Gate '${gate.id}' needs a non-empty loop body`;
  for (const step of flow.steps.filter((entry) => ids.includes(entry.id))) {
    const error = validateBodyMember(step);
    if (error) return `Step '${step.id}': ${error}`;
  }
  for (const step of flow.steps) {
    if (step.id === gate.id || ids.includes(step.id)) continue;
    if (step.dependsOn.some((dependency) => ids.includes(dependency)) && !step.dependsOn.includes(gate.id)) {
      return `Step '${step.id}': depend on the gate to consume loop output`;
    }
  }
  return null;
}

function validateBodyMember(step: IFlowStep): string | null {
  if ((step.type ?? FlowStepType.AGENT) !== FlowStepType.AGENT) return "a loop body permits agent steps only";
  if (step.strategy === ExecutionStrategyName.CLI_DELEGATE) return "cli_delegate is not allowed in a loop body";
  if (
    step.strategy !== undefined && ![ExecutionStrategyName.REACT, ExecutionStrategyName.MCP].includes(step.strategy)
  ) {
    return "unsupported loop body strategy";
  }
  if (step.execution_mode === FlowStepExecutionMode.DYNAMIC && step.strategy !== undefined) {
    return "a dynamic loop body agent cannot declare a strategy";
  }
  if (step.onError || (step.retry?.maxAttempts ?? 1) > 1) return "the gate is the only retry owner in its body";
  if (step.namespace?.writes.some((write) => write.mode === "append")) {
    return "append writes are not allowed in a loop body";
  }
  return null;
}
