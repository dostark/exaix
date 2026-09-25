/**
 * @module EffortResolutionPayload
 * @path packages/execution/src/effort_resolution_payload.ts
 * @description Single owner of the agent.effort_resolved payload shape: both emitters —
 *   AgentRunner.journalEffortResolution (planning/flow_step) and
 *   AgentComposer.journalStepEffortResolution (execution/flow_step) — build their payload
 *   through this one builder, so the payload is type-checked in one place and the two
 *   sites cannot drift (GAP-4).
 * @architectural-layer Execution
 * @dependencies [@exaix/core/events, @exaix/core, @exaix/ai]
 * @related-files [packages/execution/src/agent_runner.ts, packages/execution/src/agent_composer.ts, packages/core/src/events/domain_event_types.ts]
 */

import type { ProviderType } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { EffortResolutionPath, IAgentEffortResolvedPayload } from "@exaix/core/events";
import type { IEffortDeclarationPair, IEffortResolution } from "@exaix/ai";

/** Everything an emitter owns that the payload must represent. */
export interface IAgentEffortResolvedInput {
  path: EffortResolutionPath;
  /** The resolution whose outcome is journaled. */
  resolution: IEffortResolution;
  /** The three surfaces' declaration pairs — each entry is included only when the pair
   *  carries at least one field, matching how both emitters always described themselves. */
  declared: {
    request?: IEffortDeclarationPair;
    flow_step?: IEffortDeclarationPair;
    role?: IEffortDeclarationPair;
  };
  /** Agent-role id of the call; the single fallback rule (empty string) lives here. */
  agentRole?: string;
  providerType?: ProviderType;
  model?: string;
}

function pairOrUndefined(pair: Opt<IEffortDeclarationPair, Reason.OptionalInput>): IEffortDeclarationPair | undefined {
  if (pair && (pair.effort !== undefined || pair.thinking !== undefined)) return pair;
  return undefined;
}

/** Builds the agent.effort_resolved payload from a resolution and its call-site context.
 *  typed once here — the type checker links every emitter to IAgentEffortResolvedPayload. */
export function buildAgentEffortResolvedPayload(input: IAgentEffortResolvedInput): IAgentEffortResolvedPayload {
  return {
    path: input.path,
    agent_role: input.agentRole ?? "",
    ...(input.resolution.effort !== undefined ? { effort: input.resolution.effort } : {}),
    ...(input.resolution.thinking !== undefined ? { thinking: input.resolution.thinking } : {}),
    effort_basis: input.resolution.effortBasis,
    thinking_basis: input.resolution.thinkingBasis,
    effort_declaration_source: input.resolution.effortDeclarationSource,
    thinking_declaration_source: input.resolution.thinkingDeclarationSource,
    declared: {
      ...(pairOrUndefined(input.declared.request) ? { request: input.declared.request } : {}),
      ...(pairOrUndefined(input.declared.flow_step) ? { flow_step: input.declared.flow_step } : {}),
      ...(pairOrUndefined(input.declared.role) ? { role: input.declared.role } : {}),
    },
    ...(input.resolution.heuristicInputs
      ? {
        heuristic_inputs: {
          task_complexity: input.resolution.heuristicInputs.taskComplexity,
          complexity_source: input.resolution.heuristicInputs.complexitySource,
          ...(input.resolution.heuristicInputs.modelSize !== undefined
            ? { model_size: input.resolution.heuristicInputs.modelSize }
            : {}),
        },
      }
      : {}),
    floors_applied: input.resolution.floorsApplied,
    ...(input.providerType !== undefined ? { provider_type: input.providerType } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
  };
}
