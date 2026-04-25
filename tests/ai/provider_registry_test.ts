/**
 * @module AIProviderRegistryTest
 * @path tests/ai/provider_registry_test.ts
 * @description Verifies the AI ProviderRegistry, ensuring stable registration of LLM
 * factories, dynamic model selection, and resilient fallback when primary providers are unavailable.
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { MockStrategy, PricingTier, ProviderCostTier, ProviderType } from "@exaix/core";
import { ProviderRegistry } from "../../src/ai/provider_registry.ts";
import { AnthropicProviderFactory } from "../../src/ai/factories/anthropic_factory.ts";
import { MockProviderFactory } from "../../src/ai/factories/mock_factory.ts";
import type { IResolvedProviderOptions } from "../../src/ai/types.ts";
import { ProviderFactory } from "../../src/ai/provider_factory.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { ExaPathDefaults } from "@exaix/core";
import { TEST_MODEL_ANTHROPIC } from "../config/constants.ts";

// ============================================================================
// Basic Registry Tests
// ============================================================================

Deno.test("ProviderRegistry: can register and retrieve factories", () => {
  ProviderRegistry.clear();
  const factory = new MockProviderFactory();

  ProviderRegistry.register("test-mock", factory);
  const retrieved = ProviderRegistry.getFactory("test-mock");

  assertExists(retrieved);
  assertEquals(retrieved instanceof MockProviderFactory, true);
});

Deno.test("ProviderRegistry: returns undefined for unregistered providers", () => {
  ProviderRegistry.clear();
  const retrieved = ProviderRegistry.getFactory("non-existent");
  assertEquals(retrieved, undefined);
});

// ============================================================================
// Enhanced Metadata Tests
// ============================================================================

Deno.test("ProviderRegistry: can register providers with metadata", () => {
  ProviderRegistry.clear();

  const metadata = {
    name: "test-provider",
    description: "Test provider for unit tests",
    capabilities: ["chat", "streaming"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: ["testing", "deterministic"],
  };

  ProviderRegistry.registerWithMetadata("test-provider", new MockProviderFactory(), metadata);

  const retrieved = ProviderRegistry.getProviderMetadata("test-provider");
  assertExists(retrieved);
  assertEquals(retrieved.name, "test-provider");
  assertEquals(retrieved.costTier, ProviderCostTier.FREE);
  assertEquals(retrieved.pricingTier, PricingTier.LOCAL);
});

Deno.test("ProviderRegistry: getProvidersByCostTier returns providers filtered by cost tier", () => {
  ProviderRegistry.clear();

  // Register providers with different cost tiers
  ProviderRegistry.registerWithMetadata("free-provider", new MockProviderFactory(), {
    name: "free-provider",
    description: "Free provider",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: [ProviderCostTier.FREE],
  });

  ProviderRegistry.registerWithMetadata("paid-provider", new MockProviderFactory(), {
    name: "paid-provider",
    description: "Paid provider",
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.HIGH,
    strengths: ["premium"],
  });

  ProviderRegistry.registerWithMetadata("freemium-provider", new MockProviderFactory(), {
    name: "freemium-provider",
    description: "Freemium provider",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREEMIUM,
    pricingTier: PricingTier.FREE,
    strengths: ["balanced"],
  });

  const freeProviders = ProviderRegistry.getProvidersByCostTier(ProviderCostTier.FREE);
  const paidProviders = ProviderRegistry.getProvidersByCostTier(ProviderCostTier.PAID);
  const freemiumProviders = ProviderRegistry.getProvidersByCostTier(ProviderCostTier.FREEMIUM);

  assertEquals(freeProviders, ["free-provider"]);
  assertEquals(paidProviders, ["paid-provider"]);
  assertEquals(freemiumProviders, ["freemium-provider"]);
});

Deno.test("ProviderRegistry: getProvidersForTask returns providers sorted by cost priority", () => {
  ProviderRegistry.clear();

  // Register providers with different pricing tiers
  ProviderRegistry.registerWithMetadata("local-provider", new MockProviderFactory(), {
    name: "local-provider",
    description: "Local provider",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: ["code-generation"],
  });

  ProviderRegistry.registerWithMetadata("free-provider", new MockProviderFactory(), {
    name: "free-provider",
    description: "Free provider",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREEMIUM,
    pricingTier: PricingTier.FREE,
    strengths: ["code-generation"],
  });

  ProviderRegistry.registerWithMetadata("paid-provider", new MockProviderFactory(), {
    name: "paid-provider",
    description: "Paid provider",
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.HIGH,
    strengths: ["code-generation"],
  });

  const codeGenProviders = ProviderRegistry.getProvidersForTask("code-generation");

  // Should be sorted: local (cheapest) -> free -> high (most expensive)
  assertEquals(codeGenProviders, ["local-provider", "free-provider", "paid-provider"]);
});

Deno.test("ProviderRegistry: getProviderMetadata returns undefined for unregistered provider", () => {
  ProviderRegistry.clear();
  const metadata = ProviderRegistry.getProviderMetadata("non-existent");
  assertEquals(metadata, undefined);
});

Deno.test("ProviderRegistry: metadata includes free quota information", () => {
  ProviderRegistry.clear();

  const metadata = {
    name: "quota-provider",
    description: "Provider with quota",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREEMIUM,
    pricingTier: PricingTier.FREE,
    strengths: ["general"],
    freeQuota: {
      requestsPerDay: 1500,
      tokensPerMonth: 1000000,
    },
  };

  ProviderRegistry.registerWithMetadata("quota-provider", new MockProviderFactory(), metadata);

  const retrieved = ProviderRegistry.getProviderMetadata("quota-provider");
  assertExists(retrieved);
  assertExists(retrieved.freeQuota);
  assertEquals(retrieved.freeQuota?.requestsPerDay, 1500);
  assertEquals(retrieved.freeQuota?.tokensPerMonth, 1000000);
});

// ============================================================================
// Basic Registry Tests
// ============================================================================

Deno.test("ProviderRegistry: returns undefined for unregistered providers", () => {
  ProviderRegistry.clear();
  const retrieved = ProviderRegistry.getFactory("non-existent");
  assertEquals(retrieved, undefined);
});

Deno.test("MockProviderFactory: creates providers", async () => {
  const factory = new MockProviderFactory();
  const options: IResolvedProviderOptions = {
    provider: ProviderType.MOCK,
    model: "test-model",
    timeoutMs: 30000,
    mockStrategy: MockStrategy.RECORDED,
  };

  const provider = await factory.create(options);
  assertExists(provider);
  assertEquals(provider.id, "mock-recorded-test-model");
});

Deno.test("AnthropicProviderFactory: requires API key", async () => {
  // Ensure API key is not set
  Deno.env.delete("ANTHROPIC_API_KEY");

  const factory = new AnthropicProviderFactory();
  const options: IResolvedProviderOptions = {
    provider: ProviderType.ANTHROPIC,
    model: TEST_MODEL_ANTHROPIC,
    timeoutMs: 30000,
  };

  await assertRejects(
    async () => await factory.create(options),
    Error,
    "Authentication failed",
  );
});

Deno.test("AnthropicProviderFactory: exists and has correct interface", () => {
  const factory = new AnthropicProviderFactory();
  assertEquals(factory instanceof AnthropicProviderFactory, true);
});

Deno.test("ProviderFactory: uses registry for mock provider", async () => {
  Deno.env.delete("EXA_LLM_PROVIDER");
  Deno.env.delete("EXA_LLM_MODEL");
  Deno.env.delete("EXA_LLM_BASE_URL");

  const config = {
    system: {
      root: "/tmp/test",
      log_level: "info" as const,
    },
    paths: {
      portals: "Portals",
      workspace: "Workspace",
      memory: "Memory",
      runtime: ".exa",
      blueprints: "Blueprints",
    },
    ai: {
      provider: "mock",
      model: "test-model",
    },
  } as Config;

  const provider = await ProviderFactory.create(config);
  assertExists(provider);
  assertEquals(provider.id, "mock-recorded-test-model");
});

Deno.test("ProviderFactory: maintains backward compatibility for ollama", async () => {
  Deno.env.delete("EXA_LLM_PROVIDER");
  Deno.env.delete("EXA_LLM_MODEL");
  Deno.env.delete("EXA_LLM_BASE_URL");

  const config = {
    system: {
      root: "/tmp/test",
      log_level: "info" as const,
    },
    paths: { ...ExaPathDefaults },
    ai: {
      provider: "ollama",
      model: "llama3.2",
    },
  } as Config;

  const provider = await ProviderFactory.create(config);
  assertExists(provider);
  assertEquals(provider.id, "ollama-llama3.2");
});
