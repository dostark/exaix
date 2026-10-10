/**
 * @module ToolsRoundPolicy
 * @path packages/schemas/src/tools_round_policy.ts
 * @description Resolves the native tool-round policy that the planning and ReAct loops read on each
 *   model turn. TOML values come first, a non-null Config DB override replaces its key, and the
 *   result is validated as one complete `tools` section. Off forces one execution and one in-flight call.
 * @architectural-layer Schemas
 * @related-files [
 *   "packages/schemas/src/config.ts",
 *   "packages/core/src/types/constants.ts",
 *   "packages/core/src/config/adapter.ts"
 * ]
 */

import { DEFAULT_PLANNING_MAX_TOOL_CALLS_PER_ROUND, ToolsRoundLoop, ToolsRoundMode } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { IOverrideEntry } from "@exaix/core/config";
import { type Config, ConfigSchema, responseCallsCoverCaps, ToolsConfigSchema } from "./config.ts";

/** The live config and Config DB overrides that a policy reader resolves from. */
export interface IToolsRoundPolicySource {
  config: { get(): Config };
  configAdapter?: {
    listOverrides?(): ReadonlyArray<{ key: string; value: string | number | boolean | null; swap_class: string }>;
  };
}

/** The limits one native turn uses from request to replay. Read once per model turn. */
export interface IToolsRoundPolicy {
  readonly mode: ToolsRoundMode;
  readonly executionCap: number;
  readonly concurrency: number;
  readonly maxResponseCalls: number;
  readonly maxArgumentBytes: number;
  readonly maxReplayBytes: number;
  readonly resultTokenCap: number;
}

/** Keys of the `tools` section that the round policy resolves. */
const ROUND_TOOL_KEYS = [
  "parallel_calls",
  "max_calls_per_turn",
  "max_concurrent_calls",
  "max_response_calls",
  "max_call_argument_bytes",
  "max_round_replay_bytes",
  "max_result_tokens",
] as const;

type RoundToolField = (typeof ROUND_TOOL_KEYS)[number];
type RoundToolValues = Partial<Record<RoundToolField, string | number | boolean>>;

const TOOLS_KEY_PREFIX = "tools.";
const SINGLE_CALL = 1;

/** Non-null overrides for the round keys, keyed by the `tools` field name. */
function roundOverrides(overrides: Opt<readonly IOverrideEntry[], Reason.OptionalInput>): RoundToolValues {
  const values: RoundToolValues = {};
  for (const entry of overrides ?? []) {
    if (!entry.key.startsWith(TOOLS_KEY_PREFIX) || entry.value === null) continue;
    const field = entry.key.slice(TOOLS_KEY_PREFIX.length);
    if ((ROUND_TOOL_KEYS as readonly string[]).includes(field)) values[field as RoundToolField] = entry.value;
  }
  return values;
}

/** Resolves the policy for one native turn. Throws when a value is out of bounds or the response
 *  ceiling cannot admit the configured caps. Callers abort before the next provider call. */
export function resolveToolsRoundPolicy(
  config: Config,
  overrides: Opt<readonly IOverrideEntry[], Reason.OptionalInput>,
  loop: ToolsRoundLoop,
  planningCap: number,
): IToolsRoundPolicy {
  const tools = ToolsConfigSchema.parse({ ...(config.tools ?? {}), ...roundOverrides(overrides) });
  if (!responseCallsCoverCaps(tools.max_response_calls, [tools.max_calls_per_turn, planningCap])) {
    throw new Error(
      `tools.max_response_calls (${tools.max_response_calls}) must be at least the loop caps ` +
        `(tools.max_calls_per_turn ${tools.max_calls_per_turn}, planning cap ${planningCap})`,
    );
  }
  const off = tools.parallel_calls === ToolsRoundMode.OFF;
  const configuredCap = loop === ToolsRoundLoop.PLANNING ? planningCap : tools.max_calls_per_turn;
  return {
    mode: tools.parallel_calls,
    executionCap: off ? SINGLE_CALL : configuredCap,
    concurrency: off ? SINGLE_CALL : tools.max_concurrent_calls,
    maxResponseCalls: tools.max_response_calls,
    maxArgumentBytes: tools.max_call_argument_bytes,
    maxReplayBytes: tools.max_round_replay_bytes,
    resultTokenCap: loop === ToolsRoundLoop.PLANNING
      ? config.planning!.max_tool_result_tokens
      : tools.max_result_tokens,
  };
}

/** A reader that resolves the policy from the current config on each call.
 *  A reload or a Config DB change applies from the next call. */
export function toolsRoundPolicyReader(source: IToolsRoundPolicySource, loop: ToolsRoundLoop): () => IToolsRoundPolicy {
  return () => {
    const config = source.config.get();
    return resolveToolsRoundPolicy(
      config,
      source.configAdapter?.listOverrides?.(),
      loop,
      config.planning!.max_tool_calls_per_round,
    );
  };
}

/** The policy from schema defaults alone, for a caller that holds no config snapshot. */
export function defaultToolsRoundPolicy(loop: ToolsRoundLoop): IToolsRoundPolicy {
  return resolveToolsRoundPolicy(
    ConfigSchema.parse({ system: {} }),
    undefined,
    loop,
    DEFAULT_PLANNING_MAX_TOOL_CALLS_PER_ROUND,
  );
}
