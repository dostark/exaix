/**
 * @module ConfigPlanningSchemaTest
 * @path packages/schemas/tests/config_planning_test.ts
 * @description Tests for the `planning` section of ConfigSchema (Phase 199): the
 *   read-only planning-tool-loop knobs `tools_enabled`, `max_tool_rounds`, and
 *   `max_tool_result_tokens`, covering defaults, valid values, and bound rejection.
 * @architectural-layer Config
 * @related-files ["packages/schemas/src/config.ts", "packages/core/src/types/constants.ts"]
 */

import { assertEquals } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";

import { ExaPathDefaults, LogLevel } from "@exaix/core";
import * as DEFAULTS from "@exaix/core";

interface IBaseConfig {
  system: { root: string; log_level: string };
  paths: typeof ExaPathDefaults;
}

function baseConfig(): IBaseConfig {
  return {
    system: { root: "/tmp/exa-test", log_level: LogLevel.INFO },
    paths: { ...ExaPathDefaults },
  };
}

Deno.test("[ConfigSchema] planning defaults to tools_enabled=false, max_tool_rounds=2, max_tool_result_tokens=2000 when absent", () => {
  const result = ConfigSchema.safeParse(baseConfig());

  assertEquals(result.success, true);
  if (result.success) {
    const planning = result.data.planning!;
    assertEquals(planning.tools_enabled, DEFAULTS.DEFAULT_PLANNING_TOOLS_ENABLED);
    assertEquals(planning.tools_enabled, false);
    assertEquals(planning.max_tool_rounds, DEFAULTS.DEFAULT_PLANNING_MAX_TOOL_ROUNDS);
    assertEquals(planning.max_tool_rounds, 2);
    assertEquals(planning.max_tool_result_tokens, DEFAULTS.DEFAULT_PLANNING_MAX_TOOL_RESULT_TOKENS);
    assertEquals(planning.max_tool_result_tokens, 2000);
  }
});

Deno.test("[ConfigSchema] planning accepts explicit values within bounds", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    planning: { tools_enabled: true, max_tool_rounds: 5, max_tool_result_tokens: 10_000 },
  });

  assertEquals(result.success, true);
  if (result.success) {
    const planning = result.data.planning!;
    assertEquals(planning.tools_enabled, true);
    assertEquals(planning.max_tool_rounds, 5);
    assertEquals(planning.max_tool_result_tokens, 10_000);
  }
});

Deno.test("[ConfigSchema] rejects max_tool_rounds below the min (0)", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    planning: { max_tool_rounds: 0 },
  });

  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] rejects max_tool_rounds above the max (11)", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    planning: { max_tool_rounds: 11 },
  });

  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] rejects max_tool_result_tokens below the min (255)", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    planning: { max_tool_result_tokens: 255 },
  });

  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] rejects max_tool_result_tokens above the max (50_001)", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    planning: { max_tool_result_tokens: 50_001 },
  });

  assertEquals(result.success, false);
});
