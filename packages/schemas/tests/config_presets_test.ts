/**
 * @module ConfigPresetsTest
 * @path packages/schemas/tests/config_presets_test.ts
 * @description Phase 132 Step 2 — validates models.presets config schema parsing,
 *   partial override, and ModelProfile shape.
 * @architectural-layer Shared
 * @dependencies [@std/assert, @exaix/schemas]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ConfigSchema } from "../src/config.ts";

const MINIMAL_CONFIG = {
  system: { root: "/tmp", log_level: "info" as const },
  paths: {},
  git: {},
  provider_strategy: {},
  plugins: {},
  tools: {},
};

const FULL_PRESETS_CONFIG = {
  ...MINIMAL_CONFIG,
  model_presets: {
    S: { max_cost_per_mtok: 0.5, min_context_window: 8192, supports_thinking: false },
    M: { max_cost_per_mtok: 3, min_context_window: 32000, supports_thinking: true },
    L: { max_cost_per_mtok: 15, min_context_window: 128000, supports_thinking: true },
    XL: { max_cost_per_mtok: 75, min_context_window: 200000, supports_thinking: true },
  },
};

Deno.test("[step132.2] model_presets.S parses as a capability profile", () => {
  const config = ConfigSchema.parse(FULL_PRESETS_CONFIG);

  assertEquals(config.model_presets!.S.max_cost_per_mtok, 0.5);
  assertEquals(config.model_presets!.M.supports_thinking, true);
  assertEquals(config.model_presets!.L.min_context_window, 128000);
  assertEquals(config.model_presets!.XL.max_cost_per_mtok, 75);
});

Deno.test("[step132.2] model_presets accepts partial override (only cost changed)", () => {
  const config = ConfigSchema.parse({
    ...MINIMAL_CONFIG,
    model_presets: {
      M: { max_cost_per_mtok: 5, min_context_window: 32000, supports_thinking: true },
    },
  });

  assertEquals(config.model_presets!.M.max_cost_per_mtok, 5);
  assertEquals(config.model_presets!.M.min_context_window, 32000);
  assertEquals(config.model_presets!.M.supports_thinking, true);
});

Deno.test("[step132.2] model_presets with optional candidates array", () => {
  const config = ConfigSchema.parse({
    ...MINIMAL_CONFIG,
    model_presets: {
      L: {
        max_cost_per_mtok: 15,
        min_context_window: 128000,
        supports_thinking: true,
        candidates: ["anthropic:claude-sonnet", "openai:gpt-4o"],
      },
    },
  });

  assertEquals(config.model_presets!.L.candidates!.length, 2);
  assertEquals(config.model_presets!.L.candidates![0], "anthropic:claude-sonnet");
});

Deno.test("[step132.2] model_presets rejects invalid min_context_window (negative)", () => {
  assertThrows(
    () =>
      ConfigSchema.parse({
        ...MINIMAL_CONFIG,
        model_presets: {
          S: { max_cost_per_mtok: 0.5, min_context_window: -1, supports_thinking: false },
        },
      }),
  );
});
