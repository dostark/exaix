/**
 * @module DefaultModelRegistryTest
 * @path packages/model-registry/tests/default_model_registry_test.ts
 * @description Tests for the Solo-tier DefaultModelRegistry floor: all 13 IModelRegistry
 *   methods, overlay enrichment, error types, cost-unit G1 derivation, and regression
 *   against Phase 132 inline constants.
 */
import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import { stub } from "@std/testing/mock";
import { ProviderCostTier } from "@exaix/core/types";
import {
  type IProviderHealthChecker,
  type IProviderMetadata,
  type IProviderModelInfo,
  ProviderRegistry,
} from "@exaix/ai";
import { DefaultModelRegistry, mtokToPer1k, RegistryNotImplementedError, STATIC_OVERLAY } from "@exaix/model-registry";

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

Deno.test("getModelCost reads the per-model price and preserves a zero catalog price", async () => {
  using _metadataStub = stub(ProviderRegistry, "getProviderMetadata", () =>
    createMockProvider("catalog", {
      modelInfo: (model) => Promise.resolve({ inputPerMtok: model === "free" ? 0 : 0.02 }),
    }));
  const registry = new DefaultModelRegistry(stubHealthChecker());
  assertEquals(await registry.getModelCost("catalog", "paid"), 0.02);
  assertEquals(await registry.getModelCost("catalog", "free"), 0);
});

Deno.test("an unknown price falls back to the provider value even after a rejected lookup", async () => {
  for (const modelInfo of [() => Promise.resolve(undefined), () => Promise.reject(new Error("offline"))]) {
    using _metadataStub = stub(
      ProviderRegistry,
      "getProviderMetadata",
      () => createMockProvider("catalog", { modelInfo }),
    );
    assertEquals(await new DefaultModelRegistry(stubHealthChecker()).getModelCost("catalog", "model"), 1);
  }
});

Deno.test("getModelCapability and getProviderModels report the per-model window, cost and false capability flags", async () => {
  setupProviders();
  try {
    const metadata = ProviderRegistry.getProviderMetadata("test-openai");
    assert(metadata);
    metadata.supportsThinking = true;
    metadata.supportsEffort = true;
    metadata.modelInfo = () =>
      Promise.resolve({ contextWindow: 262_144, inputPerMtok: 0.02, supportsThinking: false, supportsEffort: false });
    const registry = new DefaultModelRegistry(stubHealthChecker());
    assertEquals(await registry.getModelCapability("test-openai", "model"), {
      minContextWindow: 262_144,
      maxCostPerMillionTokens: 0.02,
      supportsThinking: false,
      supportsEffort: false,
    });
    const entries = await registry.getProviderModels("test-openai");
    assertEquals(entries[0].contextWindow, 262_144);
    assertEquals(entries[0].costPer1kTokens, 0.00002);
    assertEquals(entries[0].capabilities.supportsEffort, false);
    assertEquals((await registry.getModelsByCapability({ minContextWindow: 200_000 })).map((entry) => entry.provider), [
      "test-openai",
    ]);
    assertEquals(await registry.getModelsByCapability({ supportsThinking: true }), []);
    assertEquals((await registry.getModelPricing("test-openai", "model")).provenance, "endpoint");
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("getContextWindow reads modelInfo when the overlay has no row", async () => {
  const models: string[] = [];
  const modelInfo: IProviderModelInfo = { contextWindow: 262_144 };
  using _metadataStub = stub(ProviderRegistry, "getProviderMetadata", () =>
    createMockProvider("catalog", {
      modelInfo: (model) => {
        models.push(model);
        return Promise.resolve(modelInfo);
      },
    }));
  const registry = new DefaultModelRegistry(stubHealthChecker());
  assertEquals(await registry.getContextWindow("catalog", "specific-model"), 262_144);
  assertEquals(models, ["specific-model"]);
});

Deno.test("getContextWindow prefers both static sources without calling modelInfo", async () => {
  let calls = 0;
  using _metadataStub = stub(ProviderRegistry, "getProviderMetadata", () =>
    createMockProvider("anthropic", {
      modelInfo: () => {
        calls++;
        return Promise.resolve({ contextWindow: 1 });
      },
    }));
  const registry = new DefaultModelRegistry(stubHealthChecker());
  assertEquals(await registry.getContextWindow("anthropic", "claude-sonnet-5"), 1_000_000);
  assertEquals(await registry.getContextWindow("anthropic", "claude-opus-5"), 1_000_000);
  assertEquals(calls, 0);
});

Deno.test("a modelInfo rejection falls back to the provider value", async () => {
  let calls = 0;
  using _metadataStub = stub(ProviderRegistry, "getProviderMetadata", () =>
    createMockProvider("catalog", {
      modelInfo: () => {
        calls++;
        return Promise.reject(new Error("catalog unavailable"));
      },
    }));
  assertEquals(await new DefaultModelRegistry(stubHealthChecker()).getContextWindow("catalog", "model"), 32_000);
  assertEquals(calls, 1);
});

Deno.test("getContextWindow falls back for absent catalog entries and keeps a defined zero", async () => {
  for (const info of [undefined, {}, { contextWindow: 0 }]) {
    using _metadataStub = stub(ProviderRegistry, "getProviderMetadata", () =>
      createMockProvider("catalog", {
        modelInfo: () => Promise.resolve(info),
      }));
    assertEquals(
      await new DefaultModelRegistry(stubHealthChecker()).getContextWindow("catalog", "model"),
      info?.contextWindow ?? 32_000,
    );
  }
});

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

Deno.test("getModelsByCapability excludes a provider that declares no window and has no catalog", async () => {
  ProviderRegistry.clear();
  try {
    ProviderRegistry.registerWithMetadata(
      "silent",
      null as never,
      createMockProvider("silent", { contextWindow: undefined }),
    );
    ProviderRegistry.registerWithMetadata(
      "catalog",
      null as never,
      createMockProvider("catalog", {
        contextWindow: undefined,
        modelInfo: () => Promise.reject(new Error("offline")),
      }),
    );
    const providers = (await new DefaultModelRegistry(stubHealthChecker()).getModelsByCapability({
      minContextWindow: 8192,
    })).map((entry) => entry.provider);
    assertEquals(providers, ["catalog"]);
  } finally {
    ProviderRegistry.clear();
  }
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

    const overlayCost = await registry.getModelCost("openai", "gpt-6-luna");
    assertEquals(overlayCost, 0.10);

    const metadataCost = await registry.getModelCost("test-openai", "test-model");
    assertEquals(metadataCost, 1.0);

    const unknownCost = await registry.getModelCost("unknown", "nonexistent");
    assertEquals(unknownCost, 0);
  },
});

Deno.test({
  name: "getContextWindow prefers overlay, then metadata, else 0",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());

    const overlayWindow = await registry.getContextWindow("anthropic", "claude-sonnet-5");
    assertEquals(overlayWindow, 1_000_000);

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

    const overlayPricing = await registry.getModelPricing("openai", "gpt-6-luna");
    assertEquals(overlayPricing.provenance, "static");
    assertExists(overlayPricing.verifiedAt);
    assertExists(overlayPricing.sourceUrl);
    assertEquals(overlayPricing.inputPerMtok, 0.10);

    const unknownPricing = await registry.getModelPricing("unknown", "nonexistent");
    assertEquals(unknownPricing.provenance, "unknown");
    assertEquals(unknownPricing.inputPerMtok, undefined);
    assertEquals(unknownPricing.verifiedAt, undefined);
  },
});

Deno.test({
  name: "getModelPricing returns the verified short-context gpt-6-luna rates with their official source",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());
    const pricing = await registry.getModelPricing("openai", "gpt-6-luna");
    assertEquals(pricing.provenance, "static");
    assertEquals(pricing.inputPerMtok, 0.1);
    assertEquals(pricing.outputPerMtok, 0.5);
    assertEquals(pricing.cacheReadPerMtok, 0.01);
    assertEquals(pricing.cacheCreationPerMtok, 0.125);
    assertExists(pricing.verifiedAt);
    assertEquals(pricing.sourceUrl, "https://developers.openai.com/api/docs/models/gpt-6-luna");
  },
});

Deno.test({
  name:
    "getModelPricing returns the deepseek-v4-pro peak-hour rates as a conservative ceiling with their official source",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());
    const pricing = await registry.getModelPricing("deepseek", "deepseek-v4-pro");
    assertEquals(pricing.provenance, "static");
    assertEquals(pricing.inputPerMtok, 1.32);
    assertEquals(pricing.outputPerMtok, 3.96);
    assertEquals(pricing.cacheReadPerMtok, 0.044);
    assertExists(pricing.verifiedAt);
    assertEquals(pricing.sourceUrl, "https://api-docs.deepseek.com/quick_start/pricing");
  },
});

Deno.test({
  name: "getModelPricing returns the gemini-3.8-flash standard rates with their official source",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());
    const pricing = await registry.getModelPricing("google", "gemini-3.8-flash");
    assertEquals(pricing.provenance, "static");
    assertEquals(pricing.inputPerMtok, 0.75);
    assertEquals(pricing.outputPerMtok, 3.75);
    assertExists(pricing.verifiedAt);
    assertEquals(pricing.sourceUrl, "https://ai.google.dev/gemini-api/docs/pricing");
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
  name: "overlay values provide correct context windows for every known provider:model pair (regression)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setupProviders();
    const registry = new DefaultModelRegistry(stubHealthChecker());

    const expectedWindows: Record<string, number> = {
      "anthropic:claude-sonnet-5": 1_000_000,
      "openai:gpt-5.6-terra": 1_050_000,
      "openai:gpt-5-mini": 400_000,
      "anthropic:claude-opus-5": 1_000_000,
    };

    for (const [key, window] of Object.entries(expectedWindows)) {
      const [provider, model] = key.split(":");
      const contextWindow = await registry.getContextWindow(provider, model);
      assertEquals(contextWindow, window, `Context window mismatch for ${key}`);
    }
  },
});

Deno.test({
  name: "retired models have no static overlay rows, so their pricing and windows are not reported",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => {
    const retiredKeys = ["openai:gpt-4o-mini", "openai:gpt-4o", "google:gemini-2.5-flash"];
    for (const key of retiredKeys) {
      assertEquals(STATIC_OVERLAY[key], undefined, `Retired overlay row still present: ${key}`);
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
