/**
 * @module ModelResolverProductionRegistryTest
 * @path packages/ai/tests/model_resolver_production_registry_test.ts
 * @description Verifies direct-provider metadata and OpenRouter catalog wiring reach production model resolution.
 * @architectural-layer AI
 * @dependencies [@std/assert, @exaix/testing, @exaix/schemas]
 * @related-files [apps/common/registry_bootstrap.ts, packages/model-registry/src/default_model_registry.ts, packages/ai/src/model_resolver.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DEFAULT_MODEL_PRESETS, getDefaultModels } from "@exaix/schemas";
import type { Config } from "@exaix/schemas";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { bootstrapProviderRegistry } from "../../../apps/common/registry_bootstrap.ts";
import { DefaultRoutingStrategy, ModelResolver, ProviderRegistry } from "@exaix/ai";
import { createStubCostTracker, createStubHealthChecker } from "./helpers/service_stubs.ts";

const M_PROFILE = DEFAULT_MODEL_PRESETS.M;

function makeProductionResolver(registry: DefaultModelRegistry): ModelResolver {
  const selector = new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker());
  return new ModelResolver(
    selector,
    {} as Config,
    createStubHealthChecker(),
    createMockEventLogger(),
    registry,
  );
}

Deno.test("booted direct providers retain metadata while OpenRouter exposes a per-model catalog", () => {
  ProviderRegistry.clear();
  bootstrapProviderRegistry();
  try {
    const cases: Array<{ provider: string; contextWindow: number; supportsThinking: boolean }> = [
      { provider: "anthropic", contextWindow: 1000000, supportsThinking: true },
      { provider: "openai", contextWindow: 1050000, supportsThinking: true },
      { provider: "google", contextWindow: 1000000, supportsThinking: true },
      { provider: "ollama", contextWindow: 8192, supportsThinking: false },
    ];
    for (const c of cases) {
      const meta = ProviderRegistry.getProviderMetadata(c.provider);
      assertEquals(meta !== undefined, true, `${c.provider} must be registered`);
      assertEquals(meta!.contextWindow, c.contextWindow, `${c.provider} contextWindow`);
      assertEquals(meta!.supportsThinking, c.supportsThinking, `${c.provider} supportsThinking`);
      assertEquals(typeof meta!.supportsEffort, "boolean", `${c.provider} supportsEffort`);
      assertEquals(typeof meta!.costPerMtok, "number", `${c.provider} costPerMtok`);
    }
    const openrouter = ProviderRegistry.getProviderMetadata("openrouter");
    assertExists(openrouter);
    assertEquals(typeof openrouter.modelInfo, "function");
    for (const field of ["supportsThinking", "supportsEffort", "contextWindow", "costPerMtok"]) {
      assertEquals(Object.hasOwn(openrouter, field), false, `openrouter ${field}`);
    }
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[132.18] model_size:M resolves to a non-mock capability-matching provider", async () => {
  ProviderRegistry.clear();
  bootstrapProviderRegistry();
  try {
    const registry = new DefaultModelRegistry(createStubHealthChecker());
    const resolver = makeProductionResolver(registry);
    const result = await resolver.resolve({ model_size: "M" });

    assertEquals(result.provider !== "mock", true, "M profile must not resolve to the capability-less mock provider");
    const meta = ProviderRegistry.getProviderMetadata(result.provider);
    assertEquals(meta !== undefined, true);
    assertEquals(
      (meta!.contextWindow ?? 0) >= M_PROFILE.min_context_window,
      true,
      "provider must satisfy M min context window",
    );
    // The model must be a real registered default, not a "{provider}-model" placeholder.
    assertEquals(getDefaultModels()[result.provider], result.model);
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[132.18] thinking:true resolves to a supportsThinking provider instead of throwing", async () => {
  ProviderRegistry.clear();
  bootstrapProviderRegistry();
  try {
    const registry = new DefaultModelRegistry(createStubHealthChecker());
    const resolver = makeProductionResolver(registry);
    const result = await resolver.resolve({ model_size: "M", thinking: true });

    assertEquals(
      ProviderRegistry.getProviderMetadata(result.provider)?.supportsThinking,
      true,
      "thinking intent must select a thinking-capable provider",
    );
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[132.18] getModelsByCapability(M profile) returns ≥1 real entry after boot", async () => {
  ProviderRegistry.clear();
  bootstrapProviderRegistry();
  try {
    const registry = new DefaultModelRegistry(createStubHealthChecker());
    const entries = await registry.getModelsByCapability({
      minContextWindow: M_PROFILE.min_context_window,
      supportsThinking: M_PROFILE.supports_thinking,
      maxCostPerMillionTokens: M_PROFILE.max_cost_per_mtok,
    });
    assertEquals(entries.length >= 1, true, "at least one provider must satisfy the M capability profile");
    for (const entry of entries) {
      assertEquals(entry.provider !== "mock", true);
      assertEquals((entry.contextWindow ?? 0) >= M_PROFILE.min_context_window, true);
    }
  } finally {
    ProviderRegistry.clear();
  }
});
