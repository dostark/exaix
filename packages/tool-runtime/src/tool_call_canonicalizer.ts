/**
 * @module ToolCallCanonicalizer
 * @path packages/tool-runtime/src/tool_call_canonicalizer.ts
 * @description The one helper every registry-backed entry point calls to canonicalize a tool
 *   call: it resolves the canonical tool, derives `acceptedParams` from that tool's
 *   registered schema, and runs canonicalizeToolCall with it. Deriving the set in one place
 *   is what keeps a planning loop's confinement check and the registry's executor looking
 *   at identical canonical parameters.
 * @architectural-layer Tool Runtime
 * @dependencies [@exaix/core]
 * @related-files [packages/core/src/types/tool_aliases.ts, packages/tool-runtime/src/tool_registry.ts]
 */

import { canonicalizeToolCall, canonicalizeToolName, TOOL_AUTH_ONLY_PARAMS } from "@exaix/core";
import type { ICanonicalizedToolCall, JSONValue } from "@exaix/core";
import type { IToolRegistry } from "@exaix/core/types";

const IMPLICIT_PARAMS: ReadonlySet<string> = new Set(TOOL_AUTH_ONLY_PARAMS);

/** The canonical tool's declared parameter keys, or undefined when the registry does not
 *  register that tool. */
export function acceptedParamsFor(
  registry: Pick<IToolRegistry, "getTools">,
  canonicalName: string,
): ReadonlySet<string> | undefined {
  const tool = registry.getTools().find((t) => t.name === canonicalName);
  if (!tool) return undefined;
  return new Set(Object.keys(tool.parameters.properties).filter((key) => !IMPLICIT_PARAMS.has(key)));
}

/** Canonicalizes a call against the registry's own schema for the canonical tool. */
export function canonicalizeForRegistry(
  registry: Pick<IToolRegistry, "getTools">,
  name: string,
  params: Record<string, JSONValue>,
): ICanonicalizedToolCall {
  return canonicalizeToolCall(name, params, acceptedParamsFor(registry, canonicalizeToolName(name)));
}
