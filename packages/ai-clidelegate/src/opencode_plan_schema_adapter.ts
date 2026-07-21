/**
 * @module OpencodePlanSchemaAdapter
 * @path packages/ai-clidelegate/src/opencode_plan_schema_adapter.ts
 * @description Normalizes a plan-JSON response from an opencode-cli planning call
 *   (CliDelegateModelProvider, tool="opencode") onto Exaix's McpToolName vocabulary and
 *   each tool's real params contract, before the text reaches PlanAdapter/plan_schema.ts
 *   validation.
 *
 *   Root cause (live-verified, sandbox mrudl4zj-f6d1059f, trace
 *   340a896b-74fe-4d85-bccf-2d045a564455): opencode's planning call runs with
 *   edit/bash/task permissions denied (buildOpencodeReadOnlyConfig in
 *   cli_delegate_model_provider.ts — this provider never edits files itself), so
 *   opencode's real tool-calling machinery never engages and it falls back to a plain
 *   assistant-text response. That text is the model freehand-writing what it thinks a
 *   plan JSON should look like, anchored to neither opencode's own native tool set
 *   (read, write, edit, bash, grep — see https://opencode.ai/docs/tools/) nor Exaix's
 *   `McpToolName` enum (packages/core/src/types/enums.ts) — e.g. it returned "edit_file"
 *   with {path, oldString, newString} three times in a row, identically, which
 *   `plan_schema.ts`'s `tool: z.nativeEnum(McpToolName)` rejects outright every time.
 *
 *   This is a best-effort normalizer, not a schema relaxation: unmapped tool names and
 *   malformed input are returned unchanged so real validation still rejects genuinely
 *   unknown tools — it only closes the specific, observed vocabulary gap.
 * @architectural-layer AI
 * @related-files [packages/ai-clidelegate/src/cli_delegate_model_provider.ts, packages/schemas/src/plan_schema.ts, packages/core/src/types/enums.ts]
 */

import { McpToolName } from "@exaix/core";
import type { JSONObject, JSONValue } from "@exaix/core";

/** Result of running a plan-JSON string through the adapter. */
export interface IAdaptOpencodePlanJsonResult {
  /** The (possibly rewritten) plan JSON text. Always valid JSON if the input was. */
  json: string;
  /** True when at least one tool name or params shape was rewritten. */
  changed: boolean;
}

interface IRawPlanAction extends JSONObject {
  tool?: JSONValue;
  params?: JSONObject;
}

interface IRawPlanStep extends JSONObject {
  tools?: JSONValue[];
  actions?: IRawPlanAction[];
}

interface IRawPlan extends JSONObject {
  steps?: IRawPlanStep[];
}

/**
 * Rewrites one action's params from a source tool's shape to the target McpToolName's
 * shape. Only "edit"-family tools need structural remapping (flat oldString/newString →
 * patches[]); every other mapped tool already uses matching param key names, so those
 * pass through unchanged once the tool name itself is remapped.
 */
type ParamsRemapper = (params: JSONObject) => JSONObject;

function remapEditParams(params: JSONObject): JSONObject {
  const path = params.path ?? params.filePath;
  const patch: JSONObject = { search: params.oldString, replace: params.newString };
  return { path, patches: [patch] };
}

function remapPathAlias(params: JSONObject): JSONObject {
  if (!("filePath" in params)) return params;
  const { filePath, ...rest } = params;
  return { path: filePath, ...rest };
}

/**
 * Opencode-vocabulary tool name -> [Exaix McpToolName, params remapper].
 *
 * "edit_file"/"edit" + {path|filePath, oldString, newString} is LIVE-VERIFIED (the
 * trace-340a896b rejection this module fixes). "read"/"write"/"bash"/"grep"/"list" are
 * opencode's documented native tool names (https://opencode.ai/docs/tools/) added
 * defensively — opencode's docs describe what each tool does but don't publish exact
 * param field names, so those five params remappers are a best-effort guess (path-alias
 * or pass-through), not a confirmed observation. They are safe no-ops if the guess is
 * wrong: an unrecognized params shape just flows through unchanged and downstream
 * execution fails the same way it would have without this adapter.
 */
type ToolMapEntry = readonly [McpToolName, ParamsRemapper];

const identityRemapper: ParamsRemapper = (p) => p;

const OPENCODE_TOOL_NAME_MAP: ReadonlyMap<string, ToolMapEntry> = new Map<string, ToolMapEntry>([
  ["edit_file", [McpToolName.PATCH_FILE, remapEditParams]],
  ["edit", [McpToolName.PATCH_FILE, remapEditParams]],
  ["read", [McpToolName.READ_FILE, remapPathAlias]],
  ["read_file", [McpToolName.READ_FILE, remapPathAlias]],
  ["write", [McpToolName.WRITE_FILE, remapPathAlias]],
  ["bash", [McpToolName.RUN_COMMAND, identityRemapper]],
  ["grep", [McpToolName.SEARCH_FILES, identityRemapper]],
  ["list", [McpToolName.LIST_DIRECTORY, remapPathAlias]],
]);

function remapToolName(name: string): McpToolName | undefined {
  const mapped = OPENCODE_TOOL_NAME_MAP.get(name);
  return mapped?.[0];
}

function remapAction(action: IRawPlanAction): { action: IRawPlanAction; changed: boolean } {
  if (typeof action.tool !== "string") return { action, changed: false };

  const mapped = OPENCODE_TOOL_NAME_MAP.get(action.tool);
  if (!mapped) return { action, changed: false };

  const [targetTool, remapParams] = mapped;
  const params = action.params ?? {};
  return {
    action: { ...action, tool: targetTool, params: remapParams(params) },
    changed: true,
  };
}

function remapStep(step: IRawPlanStep): { step: IRawPlanStep; changed: boolean } {
  let changed = false;
  const next: IRawPlanStep = { ...step };

  if (Array.isArray(step.tools)) {
    next.tools = step.tools.map((t) => {
      if (typeof t !== "string") return t;
      const remapped = remapToolName(t);
      if (remapped !== undefined) changed = true;
      return remapped ?? t;
    });
  }

  if (Array.isArray(step.actions)) {
    next.actions = step.actions.map((a) => {
      const result = remapAction(a);
      if (result.changed) changed = true;
      return result.action;
    });
  }

  return { step: next, changed };
}

/**
 * Parses `raw` as JSON and rewrites every step's `tools`/`actions[].tool`+`params` that
 * match a known opencode-vocabulary alias onto the corresponding McpToolName + params
 * shape. Returns the input unchanged (changed: false) when `raw` isn't valid JSON, has
 * no `steps` array, or contains no mappable tool names — never throws.
 */
export function adaptOpencodePlanJson(raw: string): IAdaptOpencodePlanJsonResult {
  let parsed: IRawPlan;
  try {
    parsed = JSON.parse(raw) as IRawPlan;
  } catch {
    return { json: raw, changed: false };
  }

  if (!Array.isArray(parsed.steps)) {
    return { json: raw, changed: false };
  }

  let changed = false;
  const nextSteps = parsed.steps.map((step) => {
    const result = remapStep(step);
    if (result.changed) changed = true;
    return result.step;
  });

  if (!changed) {
    return { json: raw, changed: false };
  }

  return { json: JSON.stringify({ ...parsed, steps: nextSteps }), changed: true };
}
