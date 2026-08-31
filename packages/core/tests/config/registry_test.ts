/**
 * @module ConfigRegistryTest
 * @path packages/core/tests/config/registry_test.ts
 * @description Tests for configurable() factory function, getRegisteredDefaults(),
 *   duplicate-key detection, metadata storage, and EDITION_GATED_PATHS.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { ConfigValueType, SwapClass } from "../../src/types/enums.ts";
import { configurable, getRegisteredDefaults, resolveTier } from "../../src/config/registry.ts";
import type { ConfigTier } from "../../src/config/registry.ts";
import { EDITION_GATED_PATHS } from "../../src/config/errors.ts";

Deno.test("[configuring] registry registers a key and returns the default", () => {
  const registryBefore = getRegisteredDefaults().size;
  const value = configurable({
    key: "test.registry.key1",
    default: 42,
    type: ConfigValueType.NUMBER,
    description: "A test key",
  });
  assertEquals(value, 42);
  assertEquals(getRegisteredDefaults().size, registryBefore + 1);
  const entry = getRegisteredDefaults().get("test.registry.key1");
  assertEquals(entry?.opts.default, 42);
  assertEquals(entry?.opts.type, ConfigValueType.NUMBER);
});

Deno.test("[configuring] registry returns the default value", () => {
  const value = configurable({
    key: "test.registry.key2",
    default: "hello",
    type: ConfigValueType.STRING,
    description: "Another test key",
  });
  assertEquals(value, "hello");
});

Deno.test("[configuring] registry rejects duplicate keys in strict mode", () => {
  const key = "test.registry.dup";
  configurable({ key, default: "first", type: ConfigValueType.STRING, description: "first" });
  assertThrows(
    () => {
      const origEnv = Deno.env.get("EXA_STRICT_CONFIG");
      try {
        Deno.env.set("EXA_STRICT_CONFIG", "1");
        configurable({ key, default: "second", type: ConfigValueType.STRING, description: "second" });
      } finally {
        if (origEnv !== undefined) Deno.env.set("EXA_STRICT_CONFIG", origEnv);
        else Deno.env.delete("EXA_STRICT_CONFIG");
      }
    },
    Error,
    "already registered",
  );
});

Deno.test("[configuring] registry does NOT throw without strict mode", () => {
  const key = "test.registry.nonstrict";
  configurable({ key, default: "first", type: ConfigValueType.STRING, description: "first" });
  configurable({ key, default: "second", type: ConfigValueType.STRING, description: "second" });
  const entry = getRegisteredDefaults().get(key);
  assertEquals(entry?.opts.default, "second");
});

Deno.test("[configuring] registry stores all metadata fields", () => {
  const value = configurable({
    key: "test.registry.metadata",
    default: 100,
    type: ConfigValueType.NUMBER,
    description: "Metadata test",
    min: 0,
    max: 500,
    enum: [50, 100, 200],
    swap: SwapClass.RESTART,
    edition: ["solo", "team"] as readonly string[],
  });
  assertEquals(value, 100);
  const entry = getRegisteredDefaults().get("test.registry.metadata");
  assertEquals(entry?.opts.min, 0);
  assertEquals(entry?.opts.max, 500);
  assertEquals(entry?.opts.enum, [50, 100, 200]);
  assertEquals(entry?.opts.swap, SwapClass.RESTART);
  assertEquals(entry?.opts.edition, ["solo", "team"]);
});

Deno.test("[configuring] EDITION_GATED_PATHS contains expected keys", () => {
  assertEquals(EDITION_GATED_PATHS.has("guardrail"), true);
  assertEquals(EDITION_GATED_PATHS.has("hitl"), true);
  assertEquals(EDITION_GATED_PATHS.has("voting"), true);
  assertEquals(EDITION_GATED_PATHS.size, 3);
});

// ── resolveTier() three-tier authorization ──────────────────────────────────

Deno.test("[configuring] resolveTier derives dangerous from swap:restart", () => {
  configurable({
    key: "test.tier.restart",
    default: "/root",
    type: ConfigValueType.STRING,
    description: "restart key",
    swap: SwapClass.RESTART,
  });
  const tier: ConfigTier = resolveTier("test.tier.restart");
  assertEquals(tier, "dangerous");
});

Deno.test("[configuring] resolveTier derives dangerous from edition team", () => {
  configurable({
    key: "test.tier.team",
    default: true,
    type: ConfigValueType.BOOLEAN,
    description: "team-gated key",
    swap: SwapClass.HOT,
    edition: ["team"] as readonly string[],
  });
  assertEquals(resolveTier("test.tier.team"), "dangerous");
});

Deno.test("[configuring] resolveTier defaults to leaf for swap:hot with no override", () => {
  configurable({
    key: "test.tier.hot",
    default: 1000,
    type: ConfigValueType.NUMBER,
    description: "hot leaf key",
    swap: SwapClass.HOT,
  });
  assertEquals(resolveTier("test.tier.hot"), "leaf");
});

Deno.test("[configuring] resolveTier honours explicit tier override", () => {
  configurable({
    key: "test.tier.override",
    default: "dark",
    type: ConfigValueType.STRING,
    description: "no-impact hot key marked safe",
    swap: SwapClass.HOT,
    tier: "safe",
  });
  assertEquals(resolveTier("test.tier.override"), "safe");
});

Deno.test("[configuring] resolveTier override wins even over dangerous-derived metadata", () => {
  configurable({
    key: "test.tier.override_restart",
    default: "x",
    type: ConfigValueType.STRING,
    description: "restart key explicitly downgraded to leaf",
    swap: SwapClass.RESTART,
    tier: "leaf",
  });
  assertEquals(resolveTier("test.tier.override_restart"), "leaf");
});

Deno.test("[configuring] resolveTier returns leaf for an unregistered key", () => {
  assertEquals(resolveTier("test.tier.does-not-exist"), "leaf");
});
