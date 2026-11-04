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
import type { IProjectedCallOptions } from "@exaix/ai";

/** Everything an emitter owns that the payload must represent. */
interface IAgentEffortResolvedInput {
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
  projection?: IProjectedCallOptions;
}

function pairOrUndefined(pair: Opt<IEffortDeclarationPair, Reason.OptionalInput>): IEffortDeclarationPair | undefined {
  if (pair && (pair.effort !== undefined || pair.thinking !== undefined)) return pair;
  return undefined;
}

/** The declared pairs that carry a value, under their source names. */
function declaredOf(declared: IAgentEffortResolvedInput["declared"]): IAgentEffortResolvedPayload["declared"] {
  return {
    ...(pairOrUndefined(declared.request) ? { request: declared.request } : {}),
    ...(pairOrUndefined(declared.flow_step) ? { flow_step: declared.flow_step } : {}),
    ...(pairOrUndefined(declared.role) ? { role: declared.role } : {}),
  };
}

/** The heuristic inputs of a resolution, or nothing when the resolution used none. */
function heuristicPart(resolution: IEffortResolution): Partial<IAgentEffortResolvedPayload> {
  const inputs = resolution.heuristicInputs;
  if (!inputs) return {};
  return {
    heuristic_inputs: {
      task_complexity: inputs.taskComplexity,
      complexity_source: inputs.complexitySource,
      ...(inputs.modelSize !== undefined ? { model_size: inputs.modelSize } : {}),
    },
  };
}

/** The profile, the wire values and the reason of a projection, or nothing when it has no profile. */
function projectionPart(
  projection: Opt<IProjectedCallOptions, Reason.OptionalInput>,
): Partial<IAgentEffortResolvedPayload> {
  if (!projection?.profile) return {};
  return {
    profile: projection.profile,
    wire: { effort: projection.effort ?? null, thinking: projection.thinking ?? null },
    projection_reason: projection.reason ?? null,
  };
}

/** Builds the agent.effort_resolved payload from a resolution and its call-site context.
 *  typed once here — the type checker links every emitter to IAgentEffortResolvedPayload. */
export function buildAgentEffortResolvedPayload(input: IAgentEffortResolvedInput): IAgentEffortResolvedPayload {
  const { resolution } = input;
  return {
    path: input.path,
    agent_role: input.agentRole ?? "",
    ...(resolution.effort !== undefined ? { effort: resolution.effort } : {}),
    ...(resolution.thinking !== undefined ? { thinking: resolution.thinking } : {}),
    effort_basis: resolution.effortBasis,
    thinking_basis: resolution.thinkingBasis,
    effort_declaration_source: resolution.effortDeclarationSource,
    thinking_declaration_source: resolution.thinkingDeclarationSource,
    declared: declaredOf(input.declared),
    ...heuristicPart(resolution),
    floors_applied: resolution.floorsApplied,
    ...(input.providerType !== undefined ? { provider_type: input.providerType } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...projectionPart(input.projection),
  };
}
