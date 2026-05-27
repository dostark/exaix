/**
 * @module AIProviderSelectorTest
 * @path packages/ai/tests/provider_selector_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Validates the AI selection logic, ensuring optimal provider choice based on
 * requested capabilities, cost tier constraints, and fallback availability during degradation.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { EvaluationCategory, PricingTier, ProviderCostTier, TaskComplexity } from "@exaix/core";
import { createTestConfig } from "./helpers/test_config.ts";
import { PROVIDER_OPENAI } from "@exaix/ai-openai";
import type { Config } from "@exaix/schemas";

import { initTestDbService } from "@exaix/testing";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { createStubCostTracker, createStubHealthChecker } from "./helpers/service_stubs.ts";
import { ProviderSelector } from "../src/provider_selector.ts";

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = Deno.env.get(key);
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
}

// ============================================================================
// Provider Selector Tests
// ============================================================================

Deno.test("ProviderSelector: selects optimal provider based on criteria", async () => {
  const { db: _db, cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();

    // Register test providers with different characteristics
    ProviderRegistry.registerWithMetadata("free-provider", new MockProviderFactory(), {
      name: "free-provider",
      description: "Free provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.LOCAL,
      strengths: ["general"],
    });

    ProviderRegistry.registerWithMetadata("paid-provider", new MockProviderFactory(), {
      name: "paid-provider",
      description: "Paid provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.HIGH,
      strengths: ["complex"],
    });

    const costTracker = createStubCostTracker();
    const healthService = createStubHealthChecker();

    // Import and create selector
    const selector = new ProviderSelector(ProviderRegistry, costTracker, healthService);

    const provider = await selector.selectProvider({
      preferFree: true,
      requiredCapabilities: ["chat"],
    });

    assertEquals(provider, "free-provider");
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderSelector: throws error when no suitable provider found", async () => {
  const { db: _db, cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();

    const costTracker = createStubCostTracker();
    const healthService = createStubHealthChecker();

    const selector = new ProviderSelector(ProviderRegistry, costTracker, healthService);

    await assertRejects(
      async () => {
        await selector.selectProvider({
          preferFree: true,
          requiredCapabilities: ["vision"], // No providers support vision
        });
      },
      Error,
      "No suitable provider found for criteria",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderSelector: respects budget constraints", async () => {
  const { db: _db, cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();

    // Register providers
    ProviderRegistry.registerWithMetadata("cheap-provider", new MockProviderFactory(), {
      name: "cheap-provider",
      description: "Cheap provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.LOW,
      strengths: ["general"],
    });

    ProviderRegistry.registerWithMetadata("expensive-provider", new MockProviderFactory(), {
      name: "expensive-provider",
      description: "Expensive provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.HIGH,
      strengths: ["general"],
    });

    const costTracker = createStubCostTracker();
    const healthService = createStubHealthChecker();

    // Set up high cost for expensive provider
    await costTracker.trackGeneration(
      "expensive-provider",
      "expensive-model",
      { promptTokens: 50000, completionTokens: 50000, totalTokens: 100000 },
      "trace-budget",
    );
    await costTracker.flush(); // Ensure the cost is written immediately for the test

    const selector = new ProviderSelector(ProviderRegistry, costTracker, healthService);

    const provider = await selector.selectProvider({
      maxCostUsd: 0.5, // Budget too low for expensive provider
      requiredCapabilities: ["chat"],
    });

    assertEquals(provider, "cheap-provider");
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderSelector: routes tasks by complexity", async () => {
  const { db: _db, tempDir: _tempDir, cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();

    // Register providers with different pricing tiers
    ProviderRegistry.registerWithMetadata("local-provider", new MockProviderFactory(), {
      name: "local-provider",
      description: "Local provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.LOCAL,
      strengths: ["simple"],
    });

    ProviderRegistry.registerWithMetadata("premium-provider", new MockProviderFactory(), {
      name: "premium-provider",
      description: "Premium provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.HIGH,
      strengths: ["complex"],
    });

    const costTracker = createStubCostTracker();
    const healthService = createStubHealthChecker();

    const selector = new ProviderSelector(ProviderRegistry, costTracker, healthService);

    // Simple task should prefer local provider
    const simpleProvider = await selector.selectProvider({
      taskComplexity: TaskComplexity.SIMPLE,
      requiredCapabilities: ["chat"],
    });
    assertEquals(simpleProvider, "local-provider");

    // Complex task should prefer premium provider
    const complexProvider = await selector.selectProvider({
      taskComplexity: TaskComplexity.COMPLEX,
      requiredCapabilities: ["chat"],
    });
    assertEquals(complexProvider, "premium-provider");
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderSelector: filters by required capabilities", async () => {
  const { db: _db, tempDir: _tempDir, cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();

    // Register providers with different capabilities
    ProviderRegistry.registerWithMetadata("chat-provider", new MockProviderFactory(), {
      name: "chat-provider",
      description: "Chat provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.LOCAL,
      strengths: ["general"],
    });

    ProviderRegistry.registerWithMetadata("vision-provider", new MockProviderFactory(), {
      name: "vision-provider",
      description: "Vision provider",
      capabilities: ["chat", "vision"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.HIGH,
      strengths: ["general"],
    });

    const costTracker = createStubCostTracker();
    const healthService = createStubHealthChecker();

    const selector = new ProviderSelector(ProviderRegistry, costTracker, healthService);

    // Request vision capability should select vision provider
    const provider = await selector.selectProvider({
      requiredCapabilities: ["vision"],
    });
    assertEquals(provider, "vision-provider");
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderSelector: excludes unhealthy providers", async () => {
  const { db: _db, tempDir: _tempDir, cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();

    // Register providers
    ProviderRegistry.registerWithMetadata("healthy-provider", new MockProviderFactory(), {
      name: "healthy-provider",
      description: "Healthy provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.LOCAL,
      strengths: ["general"],
    });

    ProviderRegistry.registerWithMetadata("unhealthy-provider", new MockProviderFactory(), {
      name: "unhealthy-provider",
      description: "Unhealthy provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.HIGH,
      strengths: ["general"],
    });

    const costTracker = createStubCostTracker();
    const healthService = createStubHealthChecker();

    const selector = new ProviderSelector(ProviderRegistry, costTracker, healthService);

    const provider = await selector.selectProvider({
      requiredCapabilities: ["chat"],
    });

    assertEquals(provider, "healthy-provider");
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderSelector: uses configuration for task routing", async () => {
  const { db: _db, cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();

    // Register providers with different capabilities
    ProviderRegistry.registerWithMetadata("simple-provider", new MockProviderFactory(), {
      name: "simple-provider",
      description: "Simple provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.LOCAL,
      strengths: ["general"],
    });

    ProviderRegistry.registerWithMetadata("complex-provider", new MockProviderFactory(), {
      name: "complex-provider",
      description: "Complex provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.HIGH,
      strengths: ["reasoning"],
    });

    const costTracker = createStubCostTracker();
    const healthService = createStubHealthChecker();

    // Create config with task routing
    const config = createTestConfig();
    config.provider_strategy = {
      ...config.provider_strategy,
      prefer_free: false,
      task_routing: {
        simple: ["simple-provider"],
        complex: ["complex-provider"],
      },
    } as Config["provider_strategy"];

    const selector = new ProviderSelector(ProviderRegistry, costTracker, healthService);

    // Test simple task routing
    const simpleProvider = await selector.selectProviderForTask(config, "simple");
    assertEquals(simpleProvider, "simple-provider");

    // Test complex task routing
    const complexProvider = await selector.selectProviderForTask(config, "complex");
    assertEquals(complexProvider, "complex-provider");
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderSelector: env provider selected when healthy and allowed", async () => {
  const { db: _db, cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();

    ProviderRegistry.registerWithMetadata("mock", new MockProviderFactory(), {
      name: "mock",
      description: "Mock provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.FREE,
      strengths: ["general"],
    });

    const costTracker = createStubCostTracker();
    const healthService = createStubHealthChecker();

    const selector = new ProviderSelector(ProviderRegistry, costTracker, healthService);
    const config = createTestConfig();

    config.ai = {
      ...(config.ai ?? { model: "mock", timeout_ms: 30_000, provider: "mock" }),
      model: config.ai?.model ?? "mock",
      timeout_ms: config.ai?.timeout_ms ?? 30_000,
      provider: "mock",
    };

    const selected = await selector.selectProviderForTask(config, "simple");

    assertEquals(selected, "mock");
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderSelector: env provider fallback when unregistered or unhealthy", async () => {
  const { db: _db, cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();

    ProviderRegistry.registerWithMetadata("mock", new MockProviderFactory(), {
      name: "mock",
      description: "Mock provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.FREE,
      strengths: ["general"],
    });

    const costTracker = createStubCostTracker();
    const healthService = createStubHealthChecker();

    const selector = new ProviderSelector(ProviderRegistry, costTracker, healthService);
    const config = createTestConfig();

    // ollama is not registered, so env provider falls back to intelligent selection
    config.ai = {
      ...(config.ai ?? { model: "mock", timeout_ms: 30_000, provider: "mock" }),
      model: config.ai?.model ?? "mock",
      timeout_ms: config.ai?.timeout_ms ?? 30_000,
      provider: "ollama",
    };

    const selected = await selector.selectProviderForTask(config, "simple");

    assertEquals(selected, "mock");
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderSelector: blocks paid env provider in test mode", async () => {
  const { db: _db, cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();

    ProviderRegistry.registerWithMetadata(PROVIDER_OPENAI, new MockProviderFactory(), {
      name: PROVIDER_OPENAI,
      description: "OpenAI provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.HIGH,
      strengths: ["general"],
    });

    ProviderRegistry.registerWithMetadata("mock", new MockProviderFactory(), {
      name: "mock",
      description: "Mock provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.FREE,
      strengths: ["general"],
    });

    const costTracker = createStubCostTracker();
    const healthService = createStubHealthChecker();

    const selector = new ProviderSelector(ProviderRegistry, costTracker, healthService);
    const config = createTestConfig();

    config.ai = {
      ...(config.ai ?? { model: "mock", timeout_ms: 30_000, provider: "mock" }),
      model: config.ai?.model ?? "mock",
      timeout_ms: config.ai?.timeout_ms ?? 30_000,
      provider: "openai",
    };

    const selected = await withEnv(
      { EXA_TEST_MODE: "1", EXA_TEST_ENABLE_PAID_LLM: undefined },
      () => selector.selectProviderForTask(config, "simple"),
    );

    assertEquals(selected, "mock");
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderSelector: preferFree budget excludes all PAID providers", async () => {
  const { db: _db, cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();

    // Register multiple PAID providers and one FREE
    for (let i = 0; i < 3; i++) {
      ProviderRegistry.registerWithMetadata(`paid-provider-${i}`, new MockProviderFactory(), {
        name: `paid-provider-${i}`,
        description: "Paid provider",
        capabilities: ["chat"],
        costTier: ProviderCostTier.PAID,
        pricingTier: PricingTier.HIGH,
        strengths: ["general"],
      });
    }

    ProviderRegistry.registerWithMetadata("free-provider", new MockProviderFactory(), {
      name: "free-provider",
      description: "Free provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.FREE,
      strengths: ["general"],
    });

    const costTracker = createStubCostTracker();
    const healthService = createStubHealthChecker();

    const selector = new ProviderSelector(ProviderRegistry, costTracker, healthService);

    const provider = await selector.selectProvider({
      preferFree: true,
      requiredCapabilities: ["chat"],
    });

    assertEquals(provider, "free-provider");
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderSelector: enforces budget constraints", async () => {
  const { db: _db, cleanup } = await initTestDbService();
  try {
    const costTracker = createStubCostTracker();
    const healthService = createStubHealthChecker();

    // Track enough usage to exceed budget
    await costTracker.trackGeneration(
      PROVIDER_OPENAI,
      "gpt-4o",
      { promptTokens: 250000, completionTokens: 250000, totalTokens: 500000 },
      "trace-budget-exceeded",
    );
    await costTracker.flush(); // Ensure the cost is written immediately for the test

    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata(PROVIDER_OPENAI, new MockProviderFactory(), {
      name: PROVIDER_OPENAI,
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.HIGH,
      capabilities: ["chat"],
      description: "Premium provider",
      strengths: [EvaluationCategory.QUALITY, "speed"],
    });
    ProviderRegistry.registerWithMetadata("free-provider", new MockProviderFactory(), {
      name: "free-provider",
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.FREE,
      capabilities: ["chat"],
      description: "Free provider",
      strengths: ["cost-effective"],
    });

    const selector = new ProviderSelector(ProviderRegistry, costTracker, healthService);

    // Should select free provider when premium exceeds budget
    const provider = await selector.selectProvider({
      maxCostUsd: 0.25, // Budget of $0.25
      requiredCapabilities: ["chat"],
    });

    assertEquals(provider, "free-provider");

    await _db.close();
  } finally {
    await cleanup();
  }
});
