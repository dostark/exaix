/**
 * @module AIProviderSelectorTest
 * @path tests/ai/provider_selector_test.ts
 * @description Validates the AI selection logic, ensuring optimal provider choice based on
 * requested capabilities, cost tier constraints, and fallback availability during degradation.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { DEFAULT_MCP_VERSION } from "../../src/shared/constants.ts";
import {
  EvaluationCategory,
  HealthCheckVerdict,
  PricingTier,
  ProviderCostTier,
  TaskComplexity,
} from "../../src/shared/enums.ts";
import { createTestConfig } from "./helpers/test_config.ts";
import { PROVIDER_OPENAI } from "../../src/shared/constants.ts";
import type { Config } from "../../src/shared/schemas/config.ts";
import { initTestDbService } from "../helpers/db.ts";
import { ProviderRegistry } from "../../src/ai/provider_registry.ts";
import { MockProviderFactory } from "../../src/ai/factories/mock_factory.ts";
import { CostTracker } from "../../src/services/cost_tracker.ts";
import { ProviderSelector } from "../../src/ai/provider_selector.ts";
import { HealthCheckService } from "../../src/services/health_check_service.ts";

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
  const { db, cleanup } = await initTestDbService();
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

    const costTracker = new CostTracker(db);
    const healthService = new HealthCheckService(DEFAULT_MCP_VERSION);

    // Mock health check to return healthy for both providers
    healthService.registerCheck({
      name: "free-provider",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.PASS }),
    });
    healthService.registerCheck({
      name: "paid-provider",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.PASS }),
    });

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
  const { db, cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();

    const costTracker = new CostTracker(db);
    const healthService = new HealthCheckService(DEFAULT_MCP_VERSION);

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
  const { db, cleanup } = await initTestDbService();
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

    const costTracker = new CostTracker(db);
    const healthService = new HealthCheckService(DEFAULT_MCP_VERSION);

    // Set up high cost for expensive provider
    await costTracker.trackRequest("expensive-provider", 100000); // ~$1
    await costTracker.flush(); // Ensure the cost is written immediately for the test

    // Mock health checks
    healthService.registerCheck({
      name: "cheap-provider",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.PASS }),
    });
    healthService.registerCheck({
      name: "expensive-provider",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.PASS }),
    });

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
  const { db, tempDir: _tempDir, cleanup } = await initTestDbService();
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

    const costTracker = new CostTracker(db);
    const healthService = new HealthCheckService(DEFAULT_MCP_VERSION);

    // Mock health checks
    healthService.registerCheck({
      name: "local-provider",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.PASS }),
    });
    healthService.registerCheck({
      name: "premium-provider",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.PASS }),
    });

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
  const { db, tempDir: _tempDir, cleanup } = await initTestDbService();
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

    const costTracker = new CostTracker(db);
    const healthService = new HealthCheckService(DEFAULT_MCP_VERSION);

    // Mock health checks
    healthService.registerCheck({
      name: "chat-provider",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.PASS }),
    });
    healthService.registerCheck({
      name: "vision-provider",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.PASS }),
    });

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
  const { db, tempDir: _tempDir, cleanup } = await initTestDbService();
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

    const costTracker = new CostTracker(db);
    const healthService = new HealthCheckService(DEFAULT_MCP_VERSION);

    // Mock health checks - unhealthy provider fails
    healthService.registerCheck({
      name: "healthy-provider",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.PASS }),
    });
    healthService.registerCheck({
      name: "unhealthy-provider",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.FAIL }),
    });

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
  const { db, cleanup } = await initTestDbService();
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

    const costTracker = new CostTracker(db);
    const healthService = new HealthCheckService(DEFAULT_MCP_VERSION);

    // Mock health checks
    healthService.registerCheck({
      name: "simple-provider",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.PASS }),
    });
    healthService.registerCheck({
      name: "complex-provider",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.PASS }),
    });

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
  const { db, cleanup } = await initTestDbService();
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

    const costTracker = new CostTracker(db);
    const healthService = new HealthCheckService(DEFAULT_MCP_VERSION);
    healthService.registerCheck({
      name: "mock",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.PASS }),
    });

    const selector = new ProviderSelector(ProviderRegistry, costTracker, healthService);
    const config = createTestConfig();

    const selected = await withEnv(
      { EXA_LLM_PROVIDER: "mock", EXA_TEST_MODE: "1" },
      () => selector.selectProviderForTask(config, "simple"),
    );

    assertEquals(selected, "mock");
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderSelector: env provider fallback when unregistered or unhealthy", async () => {
  const { db, cleanup } = await initTestDbService();
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

    ProviderRegistry.registerWithMetadata("ollama", new MockProviderFactory(), {
      name: "ollama",
      description: "Ollama provider",
      capabilities: ["chat"],
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.FREE,
      strengths: ["general"],
    });

    const costTracker = new CostTracker(db);
    const healthService = new HealthCheckService(DEFAULT_MCP_VERSION);
    healthService.registerCheck({
      name: "mock",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.PASS }),
    });
    healthService.registerCheck({
      name: "ollama",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.FAIL }),
    });

    const selector = new ProviderSelector(ProviderRegistry, costTracker, healthService);
    const config = createTestConfig();

    const selected = await withEnv(
      { EXA_LLM_PROVIDER: "ollama", EXA_TEST_MODE: "1" },
      () => selector.selectProviderForTask(config, "simple"),
    );

    assertEquals(selected, "mock");
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderSelector: blocks paid env provider in test mode", async () => {
  const { db, cleanup } = await initTestDbService();
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

    const costTracker = new CostTracker(db);
    const healthService = new HealthCheckService(DEFAULT_MCP_VERSION);
    healthService.registerCheck({
      name: PROVIDER_OPENAI,
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.PASS }),
    });
    healthService.registerCheck({
      name: "mock",
      critical: false,
      check: async () => await ({ status: HealthCheckVerdict.PASS }),
    });

    const selector = new ProviderSelector(ProviderRegistry, costTracker, healthService);
    const config = createTestConfig();

    const selected = await withEnv(
      { EXA_LLM_PROVIDER: "openai", EXA_TEST_MODE: "1", EXA_TEST_ENABLE_PAID_LLM: undefined },
      () => selector.selectProviderForTask(config, "simple"),
    );

    assertEquals(selected, "mock");
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderSelector: enforces budget constraints", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const costTracker = new CostTracker(db);
    const healthService = new HealthCheckService(DEFAULT_MCP_VERSION);

    // Track enough usage to exceed budget
    await costTracker.trackRequest(PROVIDER_OPENAI, 500000); // $0.50 at $0.001/1K
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

    await db.close();
  } finally {
    await cleanup();
  }
});
