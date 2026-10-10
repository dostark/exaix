/**
 * @module ToolsRoundPolicyTest
 * @path packages/schemas/tests/tools_round_policy_test.ts
 * @description Verifies the resolved native tool-round policy: loop-specific caps, the off and auto
 *   derivations, Config DB overrides over TOML, bound and cross-field validation, and reload.
 * @architectural-layer Test
 * @related-files [packages/schemas/src/tools_round_policy.ts, packages/schemas/src/config.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ToolsRoundLoop, ToolsRoundMode } from "@exaix/core";
import type { IOverrideEntry } from "@exaix/core/config";
import { ConfigSchema, resolveToolsRoundPolicy } from "@exaix/schemas";

const PLANNING_CAP = 3;

function config(tools: Record<string, string | number | boolean> = {}) {
  return ConfigSchema.parse({ system: {}, tools });
}

function override(key: string, value: string | number | boolean | null): IOverrideEntry {
  return { key, value, swap_class: "hot" };
}

Deno.test("[tools round policy] auto uses the loop cap: the planning cap for planning, tools.max_calls_per_turn for ReAct", () => {
  const cfg = config();
  const react = resolveToolsRoundPolicy(cfg, undefined, ToolsRoundLoop.REACT, PLANNING_CAP);
  assertEquals(react.mode, ToolsRoundMode.AUTO);
  assertEquals(react.executionCap, 4);
  assertEquals(react.concurrency, 4);
  assertEquals(react.maxResponseCalls, 64);
  assertEquals(react.maxArgumentBytes, 65536);
  assertEquals(react.maxReplayBytes, 1048576);
  assertEquals(react.resultTokenCap, 2048);

  const planning = resolveToolsRoundPolicy(cfg, undefined, ToolsRoundLoop.PLANNING, PLANNING_CAP);
  assertEquals(planning.executionCap, PLANNING_CAP);
  assertEquals(planning.resultTokenCap, cfg.planning!.max_tool_result_tokens);
});

Deno.test("[tools round policy] off sets one execution and one in-flight call for both loops, whatever the caps", () => {
  const cfg = config({ parallel_calls: "off", max_calls_per_turn: 20, max_concurrent_calls: 8 });
  for (const loop of [ToolsRoundLoop.PLANNING, ToolsRoundLoop.REACT]) {
    const policy = resolveToolsRoundPolicy(cfg, undefined, loop, PLANNING_CAP);
    assertEquals(policy.mode, ToolsRoundMode.OFF, loop);
    assertEquals(policy.executionCap, 1, loop);
    assertEquals(policy.concurrency, 1, loop);
  }
});

Deno.test("[tools round policy] a Config DB override replaces the TOML value and the default", () => {
  const cfg = config({ max_calls_per_turn: 6 });
  const policy = resolveToolsRoundPolicy(
    cfg,
    [override("tools.max_calls_per_turn", 9), override("tools.max_result_tokens", 512)],
    ToolsRoundLoop.REACT,
    PLANNING_CAP,
  );
  assertEquals(policy.executionCap, 9);
  assertEquals(policy.resultTokenCap, 512);
});

Deno.test("[tools round policy] a null override is unset and keeps the TOML value", () => {
  const policy = resolveToolsRoundPolicy(
    config({ max_calls_per_turn: 6 }),
    [override("tools.max_calls_per_turn", null)],
    ToolsRoundLoop.REACT,
    PLANNING_CAP,
  );
  assertEquals(policy.executionCap, 6);
});

Deno.test("[tools round policy] an override outside its bounds, fractional or non-numeric is refused", () => {
  const cfg = config();
  for (const value of [0, 21, 1.5, "7", Number.NaN]) {
    assertThrows(
      () =>
        resolveToolsRoundPolicy(cfg, [override("tools.max_calls_per_turn", value)], ToolsRoundLoop.REACT, PLANNING_CAP),
      Error,
      undefined,
      `max_calls_per_turn=${value}`,
    );
  }
});

Deno.test("[tools round policy] an override below the configured caps is refused by the response ceiling", () => {
  const cfg = config();
  assertThrows(
    () =>
      resolveToolsRoundPolicy(
        cfg,
        [override("tools.max_response_calls", 2)],
        ToolsRoundLoop.REACT,
        PLANNING_CAP,
      ),
    Error,
    "max_response_calls",
  );
});

Deno.test("[tools round policy] off ignores the configured numeric caps but keeps the response ceiling check", () => {
  const cfg = config({ parallel_calls: "off", max_calls_per_turn: 20 });
  assertThrows(
    () => resolveToolsRoundPolicy(cfg, [override("tools.max_response_calls", 5)], ToolsRoundLoop.REACT, PLANNING_CAP),
    Error,
    "max_response_calls",
  );
});

Deno.test("[tools round policy] an override for a key outside the round set is not read here", () => {
  const policy = resolveToolsRoundPolicy(
    config(),
    [override("tools.strict_params", true), override("planning.max_tool_rounds", 9)],
    ToolsRoundLoop.REACT,
    PLANNING_CAP,
  );
  assertEquals(policy.executionCap, 4);
});

Deno.test("[tools round policy] a later resolution with a changed override applies to that call only", () => {
  const cfg = config();
  const first = resolveToolsRoundPolicy(cfg, [override("tools.max_calls_per_turn", 4)], ToolsRoundLoop.REACT, 3);
  const second = resolveToolsRoundPolicy(cfg, [override("tools.max_calls_per_turn", 8)], ToolsRoundLoop.REACT, 3);
  assertEquals(first.executionCap, 4);
  assertEquals(second.executionCap, 8);
});
