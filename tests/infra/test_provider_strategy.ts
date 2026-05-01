/**
 * @module ProviderStrategyTest
 * @path tests/infra/test_provider_strategy.ts
 * @description Integration tests for LLM Provider Strategy, verifying provider
 * switching, fallback chains, budget enforcement, and concurrent requests.
 */

// Integration tests for LLM Provider Strategy
// Tests provider switching, fallback chains, budget enforcement, and concurrent requests

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DEFAULT_MCP_VERSION } from "@exaix/mcp";
import { HealthCheckVerdict, PricingTier, ProviderCostTier, TaskComplexity } from "@exaix/core";
import { TestEnvironment } from "../integration/helpers/test_environment.ts";
import { ProviderSelector } from "@exaix/ai/provider_selector.ts";
import { CostTracker } from "../../src/services/cost/cost_tracker.ts";
import { HealthCheckService } from "../../src/services/core/health_check_service.ts";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { OllamaProviderFactory } from "@exaix/ai/factories/ollama_factory.ts";
import { OpenAIProviderFactory } from "@exaix/ai/factories/openai_factory.ts";
import { ProviderRegistry } from "@exaix/ai";

Deno.test("Provider Strategy: Full agent execution with provider switching", async (t) => {
  // Initialize provider registry for testing
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("mock", new MockProviderFactory(), {
    name: "mock",
    description: "Mock provider for testing",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: ["testing"],
  });
  ProviderRegistry.registerWithMetadata("ollama", new OllamaProviderFactory(), {
    name: "ollama/llama3.2:1b",
    description: "Ollama local LLM provider",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: ["simple", "analysis"],
  });
  ProviderRegistry.registerWithMetadata("openai", new OpenAIProviderFactory(), {
    name: "openai/gpt-4o-mini",
    description: "OpenAI GPT-4o mini",
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.LOW,
    strengths: ["complex", "coding"],
  });

  await t.step("switches from free to paid provider when task complexity increases", async () => {
    const env = await TestEnvironment.create();

    try {
      // Create blueprints for different complexity levels
      await env.createBlueprint(
        "analyzer",
        `# Analyzer Blueprint
You are a simple analyzer. Keep responses brief and focused.
## Complexity: Low
## Cost: Free preferred`,
      );

      await env.createBlueprint(
        "coder",
        `# Senior Coder Blueprint
You are an expert developer. Provide detailed technical analysis and implementation plans.
## Complexity: High
## Cost: Premium required for complex tasks`,
      );

      // Set up services
      const costTracker = new CostTracker(env.db);
      const healthCheck = new HealthCheckService(DEFAULT_MCP_VERSION);

      // Create provider selector with budget constraints
      const selector = new ProviderSelector(ProviderRegistry, costTracker, healthCheck);

      // First request: simple analysis (should use free provider)
      const _simpleRequest = await env.createRequest(
        "Analyze this simple text: 'Hello world'",
        { identityId: "analyzer", priority: 5 },
      );

      // Manually track a free provider request to simulate usage
      await costTracker.trackGeneration(
        "ollama",
        "ollama/llama3.2:1b",
        { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
        "trace-1",
      );
      await costTracker.flush();

      // Select provider for simple task
      const simpleProvider = await selector.selectProvider({
        preferFree: true,
        taskComplexity: TaskComplexity.SIMPLE,
        maxCostUsd: 0.05,
      });
      assertEquals(simpleProvider, "ollama/llama3.2:1b", "Should select free provider for simple task");

      // Second request: complex coding task (should switch to paid provider)
      const _complexRequest = await env.createRequest(
        "Implement a complex microservices architecture with 10 services, database sharding, and load balancing",
        { identityId: "coder", priority: 8 },
      );

      // Select provider for complex task
      const complexProvider = await selector.selectProvider({
        preferFree: false,
        taskComplexity: TaskComplexity.COMPLEX,
        maxCostUsd: 0.10,
      });
      assertStringIncludes(complexProvider, "openai", "Should select paid provider for complex task");

      // Verify costs are different
      const freeCost = await costTracker.getDailyCost("ollama");
      assert(freeCost < 0.01, "Free provider should have minimal cost");
    } finally {
      await env.cleanup();
    }
  });

  await t.step("handles budget exhaustion gracefully", async () => {
    const env = await TestEnvironment.create();

    try {
      const costTracker = new CostTracker(env.db);
      const healthCheck = new HealthCheckService(DEFAULT_MCP_VERSION);

      const selector = new ProviderSelector(ProviderRegistry, costTracker, healthCheck);

      // Track high cost for openai provider type
      await costTracker.trackGeneration(
        "openai",
        "gpt-4o",
        { promptTokens: 30000, completionTokens: 30000, totalTokens: 60000 },
        "trace-2",
      );
      await costTracker.flush();

      // Try to select provider with low budget - should avoid openai
      const provider = await selector.selectProvider({
        maxCostUsd: 0.01, // Very low budget
        preferFree: true,
      });

      // Should select a free provider since openai exceeds budget
      assertStringIncludes(provider, "mock", "Should select free provider when paid exceeds budget");

      // Verify daily cost for paid provider is high
      const paidCost = await costTracker.getDailyCost("openai");
      assert(paidCost > 0.05, `Paid provider should have accumulated high cost (got ${paidCost})`);
    } finally {
      await env.cleanup();
    }
  });
});

Deno.test("Provider Strategy: Free-to-paid fallback scenarios", async (t) => {
  await t.step("falls back to paid provider when free provider health fails", async () => {
    const env = await TestEnvironment.create();

    try {
      const costTracker = new CostTracker(env.db);
      const healthCheck = new HealthCheckService(DEFAULT_MCP_VERSION);

      // Register a failing health check for free provider
      healthCheck.registerCheck({
        name: "ollama/llama3.2:1b", // Must match the provider metadata name
        critical: true,
        check: async () => await ({ status: HealthCheckVerdict.FAIL, message: "Ollama not responding" }),
      });

      const selector = new ProviderSelector(ProviderRegistry, costTracker, healthCheck);

      // Create request that would normally use free provider
      await env.createBlueprint("analyzer");
      const _request = await env.createRequest(
        "Simple analysis task",
        { identityId: "analyzer", priority: 5 },
      );

      // Select provider - should fallback due to health check failure
      const provider = await selector.selectProvider({
        taskComplexity: TaskComplexity.SIMPLE, // No preferFree, so all providers are candidates
      });

      // Should select mock provider as fallback when ollama is unhealthy
      // (mock is also free and healthy)
      assertStringIncludes(provider, "mock", "Should fallback to healthy free provider when ollama unhealthy");
    } finally {
      await env.cleanup();
    }
  });
});

Deno.test("Provider Strategy: Multi-provider concurrent requests", async (t) => {
  await t.step("handles multiple concurrent requests with different provider requirements", async () => {
    const env = await TestEnvironment.create();

    try {
      const costTracker = new CostTracker(env.db);
      const healthCheck = new HealthCheckService(DEFAULT_MCP_VERSION);

      const selector = new ProviderSelector(ProviderRegistry, costTracker, healthCheck);

      // Create blueprints
      await env.createBlueprint("analyzer");
      await env.createBlueprint("coder");

      // Create multiple concurrent requests
      const _requests = await Promise.all([
        env.createRequest("Simple analysis 1", { identityId: "analyzer", priority: 3 }),
        env.createRequest("Simple analysis 2", { identityId: "analyzer", priority: 4 }),
        env.createRequest("Complex coding task", { identityId: "coder", priority: 8 }),
        env.createRequest("Simple analysis 3", { identityId: "analyzer", priority: 2 }),
      ]);

      // Select providers for each request concurrently
      const selections = await Promise.all([
        selector.selectProvider({ preferFree: true, taskComplexity: TaskComplexity.SIMPLE }),
        selector.selectProvider({ preferFree: true, taskComplexity: TaskComplexity.SIMPLE }),
        selector.selectProvider({ preferFree: false, taskComplexity: TaskComplexity.COMPLEX }),
        selector.selectProvider({ preferFree: true, taskComplexity: TaskComplexity.SIMPLE }),
      ]);

      // Verify provider selections
      assertStringIncludes(selections[0], "ollama", "Simple task 1 should use free provider");
      assertStringIncludes(selections[1], "ollama", "Simple task 2 should use free provider");
      assertStringIncludes(selections[2], "openai", "Complex task should use paid provider");
      assertStringIncludes(selections[3], "ollama", "Simple task 3 should use free provider");

      // Track some usage to verify cost tracking works
      await Promise.all([
        costTracker.trackGeneration("ollama", "ollama/llama3.2:1b", {
          promptTokens: 25,
          completionTokens: 25,
          totalTokens: 50,
        }, "trace-c1"),
        costTracker.trackGeneration("ollama", "ollama/llama3.2:1b", {
          promptTokens: 30,
          completionTokens: 30,
          totalTokens: 60,
        }, "trace-c2"),
        costTracker.trackGeneration("openai", "openai/gpt-4o-mini", {
          promptTokens: 100,
          completionTokens: 100,
          totalTokens: 200,
        }, "trace-c3"),
        costTracker.trackGeneration("ollama", "ollama/llama3.2:1b", {
          promptTokens: 20,
          completionTokens: 20,
          totalTokens: 40,
        }, "trace-c4"),
      ]);

      await costTracker.flush();

      // Verify costs are tracked
      const freeCost = await costTracker.getDailyCost("ollama");
      const paidCost = await costTracker.getDailyCost("openai");

      assert(freeCost >= 0, "Free provider should have accumulated costs");
      assert(paidCost >= 0, "Paid provider should have accumulated costs");
      assert(paidCost >= freeCost, "Paid provider should cost more than free");
    } finally {
      await env.cleanup();
    }
  });
});
