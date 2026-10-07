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
import {
  DEFAULT_FLOW_GATE_MAX_EVALUATIONS,
  FlowGateOnFail,
  FlowInputSource,
  FlowStepExecutionMode,
  FlowStepOnErrorAction,
  FlowStepType,
} from "@exaix/core";

import { resolveConfigurableBounds } from "@exaix/core/config";
import { validateLoopBody } from "./loop_body.ts";

/** Runs pre-execution structural checks against a flow definition. */
export class FlowRuntimeValidator {
  validateGatePolicies(flow: IFlow, ceiling = DEFAULT_FLOW_GATE_MAX_EVALUATIONS): string | null {
    const bounds = resolveConfigurableBounds("flow.max_gate_evaluations");
    if (!Number.isInteger(ceiling) || ceiling < bounds.min! || ceiling > bounds.max!) {
      return "Invalid gate evaluation ceiling";
    }
    for (const step of flow.steps) {
      const error = this.validateControlStep(flow, step, ceiling);
      if (error) return error;
    }
    return null;
  }
  private validateControlStep(flow: IFlow, step: IFlowStep, ceiling: number): string | null {
    if (step.input.source === FlowInputSource.FEEDBACK) return "use a gate with onFail: retry and loop.backTo";
    if (step.loop && step.type !== FlowStepType.GATE) return "loop is valid on gate steps only";
    if (step.type !== FlowStepType.BRANCH && (step.branches !== undefined || step.default !== undefined)) {
      return "branches and default are valid on branch steps only";
    }
    if ([FlowStepType.GATE, FlowStepType.BRANCH].includes(step.type) && (step.retry?.maxAttempts ?? 1) > 1) {
      return "Control steps cannot use generic retries";
    }
    if (step.type === FlowStepType.BRANCH) return this.validateBranch(flow, step);
    if (step.type !== FlowStepType.GATE) return null;
    if (step.onError) return `Step '${step.id}': a gate's failure policy is evaluate.onFail`;
    return this.validateGateLimits(flow, step, ceiling);
  }
  private validateBranch(flow: IFlow, step: IFlowStep): string | null {
    if (
      (step.execution_mode ?? FlowStepExecutionMode.DECLARED) !== FlowStepExecutionMode.DECLARED ||
      step.strategy !== undefined ||
      step.effort !== undefined || step.thinking !== undefined || step.condition !== undefined ||
      step.onError !== undefined
    ) {
      return `Branch '${step.id}' must be a declared single call without condition or recovery policies`;
    }
    const targets = [...(step.branches ?? []).map((branch) => branch.goto), ...(step.default ? [step.default] : [])];
    if (targets.some((id) => !flow.steps.find((target) => target.id === id)?.dependsOn.includes(step.id))) {
      return `Branch '${step.id}' targets must directly depend on it`;
    }
    return null;
  }
  private validateGateLimits(flow: IFlow, step: IFlowStep, ceiling: number): string | null {
    if (!step.evaluate) return `Gate '${step.id}' requires evaluate config`;
    const count = step.evaluate.maxRetries ?? 3;
    if (!Number.isInteger(count) || count < 1 || count > ceiling) {
      return `Gate '${step.id}' exceeds the evaluation ceiling`;
    }
    if (step.loop?.maxIterations !== undefined || step.loop?.targetScore !== undefined) {
      return "gate loops use evaluate limits";
    }
    if (step.evaluate.onFail !== FlowGateOnFail.RETRY) return null;
    if (count < 2) return "a retrying gate needs maxRetries >= 2";
    return validateLoopBody(flow, step);
  }
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
   *  agent role is rejected up front instead of failing mid-execution. */
  async validateStepAgentRoles(
    flow: IFlow,
    hasBlueprint: (agentRole: string) => Promise<boolean>,
  ): Promise<string | null> {
    for (const step of flow.steps) {
      if (!step.agent_role) {
        return `Step '${step.id}' has no agent role`;
      }
      if (!(await hasBlueprint(step.agent_role))) {
        return `Step '${step.id}' references agent role '${step.agent_role}' that does not exist in the blueprint catalog`;
      }
    }
    return null;
  }
}
