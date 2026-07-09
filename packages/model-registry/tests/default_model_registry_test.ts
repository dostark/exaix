/**
 * @module DefaultModelRegistryTest
 * @path packages/model-registry/tests/default_model_registry_test.ts
 * @description Tests for the Solo-tier DefaultModelRegistry floor: all 13 IModelRegistry
 *   methods, overlay enrichment, error types, cost-unit G1 derivation, and regression
 *   against Phase 132 inline constants.
 */
import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import { MODEL_CONTEXT_WINDOWS, ProviderCostTier } from "@exaix/core/types";
import { type IProviderHealthChecker, type IProviderMetadata, ProviderRegistry } from "@exaix/ai";
import { DefaultModelRegistry, mtokToPer1k, RegistryNotImplementedError } from "@exaix/model-registry";

function createMockProvider(name: string, overrides: Partial<IProviderMetadata> = {}): IProviderMetadata {
  return {
    name,
    description: `Test provider ${name}`,
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: "medium" as never,
    strengths: [],
    costPerMtok: 1.0,
    contextWindow: 32_000,
    supportsThinking: false,
    supportsEffort: false,
    ...overrides,
  };
}

function stubHealthChecker(healthy = true): IProviderHealthChecker {
  return { checkProvider: () => Promise.resolve(healthy) };
}

function setupProviders(): void {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("test-openai", null as never, createMockProvider("test-openai"));
  ProviderRegistry.registerWithMetadata("test-google", null as never, createMockProvider("test-google"));
}

Deno.test({
  name: "getModelsByCapability filters registered providers by profile predicate",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());
    const result = await registry.getModelsByCapability({ minContextWindow: 10_000 });
    assert(result.length > 0, "should return at least one model");
    assertEquals(result[0].provider, "test-openai");
  },
});

Deno.test({
  name: "getProviderModels returns overlay-enriched entries for a provider",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());
    const result = await registry.getProviderModels("test-openai");
    assertEquals(result.length, 1);
    assertEquals(result[0].provider, "test-openai");
  },
});

Deno.test({
  name: "getModelCost returns per-Mtok overlay price, falls to metadata costPerMtok, else 0",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());

    const overlayCost = await registry.getModelCost("openai", "gpt-4o-mini");
    assertEquals(overlayCost, 0.15);

    const metadataCost = await registry.getModelCost("test-openai", "test-model");
    assertEquals(metadataCost, 1.0);

    const unknownCost = await registry.getModelCost("unknown", "nonexistent");
    assertEquals(unknownCost, 0);
  },
});

Deno.test({
  name: "getContextWindow prefers overlay, then MODEL_CONTEXT_WINDOWS, then metadata, else 0",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());

    const overlayWindow = await registry.getContextWindow("openai", "gpt-4o-mini");
    assertEquals(overlayWindow, 128_000);

    const constantsWindow = await registry.getContextWindow("anthropic", "claude-3-5-sonnet");
    assertEquals(constantsWindow, MODEL_CONTEXT_WINDOWS["anthropic:claude-3-5-sonnet"]);

    const unknownWindow = await registry.getContextWindow("unknown", "nonexistent");
    assertEquals(unknownWindow, 0);
  },
});

Deno.test({
  name: "getModelPricing returns provenance=static with verifiedAt for overlay rows and unknown otherwise",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());

    const overlayPricing = await registry.getModelPricing("openai", "gpt-4o-mini");
    assertEquals(overlayPricing.provenance, "static");
    assertExists(overlayPricing.verifiedAt);
    assertExists(overlayPricing.sourceUrl);
    assertEquals(overlayPricing.inputPerMtok, 0.15);

    const unknownPricing = await registry.getModelPricing("unknown", "nonexistent");
    assertEquals(unknownPricing.provenance, "unknown");
    assertEquals(unknownPricing.inputPerMtok, undefined);
    assertEquals(unknownPricing.verifiedAt, undefined);
  },
});

Deno.test({
  name: "costPer1kTokens on IModelEntry equals inputPerMtok/1000 via the shared helper (G1)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());
    const models = await registry.getModelsByCapability({});
    for (const entry of models) {
      const cost = await registry.getModelCost(entry.provider, entry.model);
      assertEquals(entry.costPer1kTokens, mtokToPer1k(cost));
    }
  },
});

Deno.test({
  name: "getLatencyStats and rankByLatency throw RegistryNotImplementedError; recordLatency is a no-op",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());

    await assertRejects(
      () => registry.getLatencyStats("test-openai", "test-model"),
      RegistryNotImplementedError,
    );
    await assertRejects(
      () => registry.rankByLatency([{ provider: "test-openai", model: "test-model" }]),
      RegistryNotImplementedError,
    );

    await registry.recordLatency("test-openai", "test-model", 100);
  },
});

Deno.test({
  name: "recordCall/getRateLimit track in-memory counts; getProviderHealth delegates to the injected checker",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());

    const rate1 = await registry.getRateLimit("test-openai");
    assertEquals(rate1.remaining, 100);

    await registry.recordCall("test-openai");
    const rate2 = await registry.getRateLimit("test-openai");
    assertEquals(rate2.remaining, 99);

    const health = await registry.getProviderHealth("test-openai");
    assertEquals(health, "healthy");
  },
});

Deno.test({
  name: "overlay values match Phase 132 inline constants for every known provider:model pair (regression)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());

    for (const [key, window] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
      const [provider, model] = key.split(":");
      const contextWindow = await registry.getContextWindow(provider, model);
      assertEquals(contextWindow, window, `Context window mismatch for ${key}`);
    }
  },
});

Deno.test({
  name: "getProviderModels for an unknown provider name returns an empty array (no crash)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());
    const result = await registry.getProviderModels("nonexistent");
    assertEquals(result, []);
  },
});

Deno.test({
  name: "getModelCost for an unknown provider:model pair falls through to 0 (no crash)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());
    const cost = await registry.getModelCost("nonexistent", "ghost-model");
    assertEquals(cost, 0);
  },
});

Deno.test({
  name: "getModelsByCapability for profile that no provider matches returns an empty array",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());
    const result = await registry.getModelsByCapability({ minContextWindow: 9_999_999 });
    assertEquals(result, []);
  },
});

Deno.test({
  name: "recordCall then getRateLimit returns incremented count; calling recordCall twice doubles the count",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());

    await registry.recordCall("test-openai");
    const rate1 = await registry.getRateLimit("test-openai");
    assertEquals(rate1.remaining, 99);

    await registry.recordCall("test-openai");
    const rate2 = await registry.getRateLimit("test-openai");
    assertEquals(rate2.remaining, 98);
  },
});
