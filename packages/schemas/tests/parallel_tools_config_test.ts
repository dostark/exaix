/**
 * @module ParallelToolsConfigSchemaTest
 * @path packages/schemas/tests/parallel_tools_config_test.ts
 * @description Tests the native tool-round keys of the `tools` section: defaults, integer and range
 *   bounds, the parallel_calls enum, and the cross-field response ceiling against the loop caps.
 * @architectural-layer Config
 * @related-files ["packages/schemas/src/config.ts", "packages/core/src/types/constants.ts"]
 */

import { ExaPathDefaults } from "@exaix/shared";
import { assertEquals } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";
import { type JSONValue, LogLevel } from "@exaix/core";

function baseConfig(): Record<string, JSONValue> {
  return {
    system: { root: "/tmp/exa-test", log_level: LogLevel.INFO },
    paths: { ...ExaPathDefaults },
  };
}

/** Keeps the loop caps low so that a bound test varies one key at a time. */
function withTools(tools: Record<string, JSONValue>): Record<string, JSONValue> {
  return {
    ...baseConfig(),
    planning: { max_tool_calls_per_round: 1 },
    tools: { max_calls_per_turn: 1, max_response_calls: 64, ...tools },
  };
}

Deno.test("[ConfigSchema] tools round keys default to the documented values", () => {
  const result = ConfigSchema.safeParse(baseConfig());
  assertEquals(result.success, true);
  if (result.success) {
    const tools = result.data.tools!;
    assertEquals(tools.parallel_calls, "auto");
    assertEquals(tools.max_calls_per_turn, 4);
    assertEquals(tools.max_concurrent_calls, 4);
    assertEquals(tools.max_response_calls, 64);
    assertEquals(tools.max_call_argument_bytes, 65536);
    assertEquals(tools.max_round_replay_bytes, 1048576);
    assertEquals(tools.max_result_tokens, 2048);
  }
});

const BOUNDS: ReadonlyArray<readonly [string, number, number]> = [
  ["max_calls_per_turn", 1, 20],
  ["max_concurrent_calls", 1, 8],
  ["max_response_calls", 1, 128],
  ["max_call_argument_bytes", 1024, 1048576],
  ["max_round_replay_bytes", 16384, 16777216],
  ["max_result_tokens", 128, 16384],
];

for (const [key, min, max] of BOUNDS) {
  Deno.test(`[ConfigSchema] tools.${key} accepts its bounds and rejects values outside them`, () => {
    for (const value of [min, max]) {
      assertEquals(ConfigSchema.safeParse(withTools({ [key]: value })).success, true, `${key}=${value}`);
    }
    for (const value of [min - 1, max + 1, 1.5, 0, -1, Number.NaN]) {
      assertEquals(ConfigSchema.safeParse(withTools({ [key]: value })).success, false, `${key}=${value}`);
    }
  });
}

Deno.test("[ConfigSchema] tools.parallel_calls accepts auto and off and rejects any other value", () => {
  for (const value of ["auto", "off"]) {
    assertEquals(ConfigSchema.safeParse(withTools({ parallel_calls: value })).success, true, value);
  }
  for (const value of ["OFF", "on", "", true]) {
    assertEquals(ConfigSchema.safeParse(withTools({ parallel_calls: value })).success, false, String(value));
  }
});

Deno.test("[ConfigSchema] tools.max_response_calls must cover the ReAct cap and the planning cap", () => {
  assertEquals(
    ConfigSchema.safeParse({ ...baseConfig(), tools: { max_response_calls: 3 } }).success,
    false,
    "below the default ReAct cap of 4",
  );
  assertEquals(
    ConfigSchema.safeParse({
      ...baseConfig(),
      planning: { max_tool_calls_per_round: 3 },
      tools: { max_response_calls: 2, max_calls_per_turn: 2 },
    }).success,
    false,
    "below the planning cap of 3",
  );
  assertEquals(
    ConfigSchema.safeParse({ ...baseConfig(), tools: { max_response_calls: 4 } }).success,
    true,
    "equal to the default ReAct cap",
  );
});
