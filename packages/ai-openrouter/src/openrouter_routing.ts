/**
 * @module OpenRouterRouting
 * @path packages/ai-openrouter/src/openrouter_routing.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts", "packages/ai-openrouter/src/constants.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/core"]
 * @description Routing policy for the OpenRouter request body. A request that carries a routed feature
 * asks OpenRouter to route only to providers that support every parameter. An operator value always wins.
 */

import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { OPENROUTER_SESSION_ID_MAX_CHARS } from "./constants.ts";

/** Body fields that a route can silently drop unless `provider.require_parameters` is true. */
export interface IOpenRouterRoutedFeatures {
  tools?: JSONValue[];
  response_format?: Record<string, JSONValue>;
  reasoning?: Record<string, JSONValue>;
}

/** The routing fields that the policy reads and writes on the body. */
export interface IOpenRouterPolicyTarget extends IOpenRouterRoutedFeatures {
  provider?: { require_parameters?: boolean; order?: string[] };
  session_id?: string;
}

/** True when the body asks for tools, a response format or reasoning. An empty tool list is not a feature. */
export function carriesRoutedFeature(body: IOpenRouterRoutedFeatures): boolean {
  return (body.tools?.length ?? 0) > 0 || body.response_format !== undefined || body.reasoning !== undefined;
}

/** Sets `provider.require_parameters` to true for a feature-carrying body, unless the operator already set it. */
export function applyRequireParameters(body: IOpenRouterPolicyTarget): void {
  if (body.provider?.require_parameters !== undefined || !carriesRoutedFeature(body)) return;
  body.provider = { ...body.provider, require_parameters: true };
}

/** Sends the trace id as the sticky session key, except when a manual order disables sticky routing. */
export function applySessionKey(body: IOpenRouterPolicyTarget, traceId: Opt<string, Reason.TraceAbsent>): void {
  if (!traceId || traceId.length > OPENROUTER_SESSION_ID_MAX_CHARS || body.provider?.order !== undefined) return;
  body.session_id = traceId;
}
