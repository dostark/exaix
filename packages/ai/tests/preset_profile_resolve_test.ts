/**
 * @module PresetProfileResolveTest
 * @path packages/ai/tests/preset_profile_resolve_test.ts
 * @description Phase 132 Step 2 — validates that model_size profiles filter provider
 *   candidates correctly by context window, thinking, and cost constraints.
 * @architectural-layer AI
 * @dependencies [@std/assert, @exaix/schemas, @exaix/ai]
 */

import { assertEquals } from "@std/assert";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { initTestDbService } from "@exaix/testing";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { resolvePresetFromSize } from "../src/model_resolver.ts";

function registerProvider(
  name: string,
  opts: { contextWindow?: number; supportsThinking?: boolean; costPerMtok?: number } = {},
): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
    contextWindow: opts.contextWindow ?? 128000,
    supportsThinking: opts.supportsThinking,
    costPerMtok: opts.costPerMtok ?? 1,
  });
}

Deno.test("[step132.2] resolvePresetFromSize 'L' includes providers matching L profile", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("big-model", { contextWindow: 200000, supportsThinking: true, costPerMtok: 10 });
    registerProvider("small-model", { contextWindow: 4096, supportsThinking: false, costPerMtok: 0.5 });

    const result = await resolvePresetFromSize("L");
    assertEquals(result.provider, "big-model");
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.2] resolvePresetFromSize 'S' excludes thinking models when thinking=false", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("thinker", { contextWindow: 32000, supportsThinking: true, costPerMtok: 3 });
    registerProvider("simple", { contextWindow: 8192, supportsThinking: false, costPerMtok: 0.5 });

    const result = await resolvePresetFromSize("S");
    assertEquals(result.provider, "simple");
  } finally {
    await cleanup();
  }
});
