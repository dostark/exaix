/**
 * @module FlowCapabilityRegistration
 * @path apps/daemon/src/flow_capability_registration.ts
 * @description Captures installed flow capabilities after edition modules register specialized handlers.
 * @architectural-layer Application
 * @dependencies [@exaix/core, @exaix/flow]
 * @related-files [apps/daemon/src/bootstrap_team.ts, apps/daemon/main.ts]
 */
import { CAP_VOTING, type ICapabilityModule, isCapabilityEligible } from "@exaix/core/composer";
import type { IExecutor } from "@exaix/core/types";
import {
  getInstalledFlowCapabilities,
  type IAgentExecutor,
  type IFlowStepHandlerRegistry,
  voterLane,
} from "@exaix/flow";

export function registerFlowCapabilityModules(
  edition: string,
  modules: readonly ICapabilityModule[],
  registry: IFlowStepHandlerRegistry,
): ReadonlySet<string> {
  if (!isCapabilityEligible(CAP_VOTING, edition)) return new Set();
  for (const module of modules) module.registerFlowStepHandlers?.(registry);
  return getInstalledFlowCapabilities(registry);
}

/** Prepared voter prompts retain the originating flow reference and binding snapshot. */
export function createVotingExecutor(agentExecutor: IAgentExecutor): IExecutor {
  return {
    run: async (blueprint, prompt, context) => {
      const { runnerIndex, ...flowContext } = context ?? {};
      const voterRecording = flowContext.recording && flowContext.flowStepId && runnerIndex !== undefined
        ? { recordingLaneId: voterLane(flowContext.flowStepId, runnerIndex) }
        : {};
      const result = await agentExecutor.run(blueprint, {
        ...flowContext,
        ...voterRecording,
        userPrompt: prompt,
        context: {},
      });
      return { content: result.content };
    },
  };
}
