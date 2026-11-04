/**
 * @module AgentRunnerGenerationHints
 * @path packages/execution/src/agent_runner_generation_hints.ts
 * @description The per-call generation hints of an agent run and the model options built from them.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_runner.ts, packages/execution/src/agent_runner_planning_tools.ts]
 */

import type { ICallSite, IModelOptions } from "@exaix/ai/types.ts";
import type { EffortTier } from "@exaix/schemas";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

/** Bundles executeWithRetry's per-call generation hints into one param, keeping it under
 *  the 7-parameter style limit. Effort/thinking here are always RESOLVED values from
 *  EffortResolver — the declaration-time surface ("auto") never enters this object. */
export interface IGenerationHints {
  conversationId: Opt<string, Reason.TraceAbsent>;
  jsonSchema: Opt<Record<string, JSONValue>, Reason.OptionalInput>;
  callSite: Opt<ICallSite, Reason.OptionalContext>;
  thinking: Opt<boolean, Reason.OptionalContext>;
  effort: Opt<EffortTier, Reason.OptionalContext>;
}

/** Builds the model options for a call. The single call and the planning tool loop share this shape. */
export function buildGenerateOptions(hints: IGenerationHints): IModelOptions | undefined {
  const { conversationId, jsonSchema, callSite, thinking, effort } = hints;
  return conversationId || jsonSchema || callSite || thinking !== undefined || effort
    ? {
      ...(conversationId ? { conversationId } : {}),
      ...(conversationId ? { traceId: conversationId } : {}),
      ...(thinking !== undefined ? { thinking } : {}),
      ...(effort ? { effort } : {}),
      ...(jsonSchema ? { jsonSchema } : {}),
      ...(callSite ? { callSite } : {}),
    }
    : undefined;
}
