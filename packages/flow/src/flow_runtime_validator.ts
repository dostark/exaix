/**
 * @module FlowRuntimeValidator
 * @path packages/flow/src/flow_runtime_validator.ts
 * @description Pre-execution structural checks run by FlowRunner.execute()
 *   before a flow's waves are scheduled: cyclic fallback chains and
 *   parallel-group reference integrity. Extracted from FlowRunner.
 * @architectural-layer Flow
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import { FlowStepExecutionMode, FlowStepOnErrorAction, FlowStepType } from "@exaix/core";

/** Runs pre-execution structural checks against a flow definition. */
export class FlowRuntimeValidator {
  findCyclicFallbackChain(flow: IFlow): string[] | null {
    const stepsById = new Map(flow.steps.map((step) => [step.id, step]));

    for (const startStep of flow.steps) {
      const path: string[] = [];
      const seenAt = new Map<string, number>();
      let currentStep: IFlowStep | undefined = startStep;

      while (currentStep?.onError?.action === FlowStepOnErrorAction.FALLBACK && currentStep.onError.fallbackStep) {
        seenAt.set(currentStep.id, path.length);
        path.push(currentStep.id);

        const nextStep = stepsById.get(currentStep.onError.fallbackStep);
        if (!nextStep) {
          break;
        }

        const cycleStartIndex = seenAt.get(nextStep.id);
        if (cycleStartIndex !== undefined) {
          return [...path.slice(cycleStartIndex), nextStep.id];
        }

        currentStep = nextStep;
      }
    }

    return null;
  }

  validateParallelGroups(flow: IFlow): string | null {
    const stepsById = new Map(flow.steps.map((step) => [step.id, step]));
    const groupMembers = new Map<string, Set<string>>();

    for (const step of flow.steps) {
      const groupId = step.parallel?.group;
      if (!groupId) {
        continue;
      }

      const members = groupMembers.get(groupId) ?? new Set<string>();
      members.add(step.id);
      groupMembers.set(groupId, members);
    }

    for (const step of flow.steps) {
      for (const groupId of step.mergeFromGroups ?? []) {
        if (!groupMembers.has(groupId)) {
          return `Step '${step.id}' references unknown parallel group '${groupId}'`;
        }
      }

      const order = step.parallel?.order;
      const groupId = step.parallel?.group;
      if (groupId && order) {
        const members = groupMembers.get(groupId) ?? new Set<string>();
        for (const orderedStepId of order) {
          if (!members.has(orderedStepId)) {
            return `Parallel group '${groupId}' order entry '${orderedStepId}' does not match any group member step ID`;
          }
        }
      }

      for (const dependencyId of step.dependsOn ?? []) {
        const dependency = stepsById.get(dependencyId);
        if (!dependency?.parallel?.group || !step.parallel?.group) {
          continue;
        }

        if (dependency.parallel.group !== step.parallel.group) {
          return `Steps '${dependency.id}' and '${step.id}' cannot declare different parallel groups across a dependency edge`;
        }
      }
    }

    return null;
  }

  /** Belt-and-suspenders runtime check mirroring the `FlowStepSchema` refine — catches a
   *  flow loaded from a source that bypassed schema validation. */
  validateStepStrategy(flow: IFlow): string | null {
    for (const step of flow.steps) {
      if (step.strategy === undefined) continue;
      if (step.execution_mode === FlowStepExecutionMode.DYNAMIC) {
        return `Step '${step.id}' declares strategy '${step.strategy}' but execution_mode is DYNAMIC`;
      }
      if (step.type !== FlowStepType.AGENT) {
        return `Step '${step.id}' declares strategy '${step.strategy}' but is not an agent-type step`;
      }
    }
    return null;
  }

  /** The whole step list is checked, so a flow whose next step references a missing
   *  identity is rejected up front instead of failing mid-execution. */
  async validateStepIdentities(
    flow: IFlow,
    hasBlueprint: (identityId: string) => Promise<boolean>,
  ): Promise<string | null> {
    for (const step of flow.steps) {
      if (!step.agent_role) {
        return `Step '${step.id}' has no identity`;
      }
      if (!(await hasBlueprint(step.agent_role))) {
        return `Step '${step.id}' references identity '${step.agent_role}' that does not exist in the blueprint catalog`;
      }
    }
    return null;
  }
}
