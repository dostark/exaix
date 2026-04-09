/**
 * @module RateLimitedProviderTest
 * @path tests/ai/rate_limited_provider_test.ts
 * @description Verifies the RateLimitedProvider wrapper, ensuring strict adherence to API quotas
 * (RPM/TPM), token usage estimation, and graceful queuing of overrun requests.
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { type Spy, spy } from "@std/testing/mock";
import { RateLimitedProvider, RateLimitError } from "../../src/ai/rate_limited_provider.ts";
import type { IModelProvider } from "../../src/ai/types.ts";
import { CostTracker } from "../../src/services/cost/cost_tracker.ts";
import { PROVIDER_OPENAI } from "../../src/shared/constants.ts";
import { initTestDbService } from "../helpers/db.ts";

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a mock provider for testing
 */
function createMockProvider(responses: string[] = ["response"]): IModelProvider {
  let callCount = 0;
  const generateSpy: Spy = spy((_prompt: string) => {
    const response = responses[callCount % responses.length];
    callCount++;
    return response;
  });

  return {
    id: "mock-provider",
    generate: generateSpy,
  };
}

/**
 * Create a mock provider that throws errors
 */
function createErrorProvider(error: Error): IModelProvider {
  const generateSpy: Spy = spy(() => {
    throw error;
  });

  return {
    id: "error-provider",
    generate: generateSpy,
  };
}

// ============================================================================
// Unit Tests for RateLimitedProvider
// ============================================================================

Deno.test("RateLimitedProvider: allows calls within minute limit", async () => {
  const mockProvider = createMockProvider();
  const rateLimited = new RateLimitedProvider(mockProvider, {
    maxCallsPerMinute: 3,
    maxTokensPerHour: 10000, // Increased limit
    maxCostPerDay: 10,
    costPer1kTokens: 0.03,
  });

  // Should allow 3 calls within limit
  await rateLimited.generate("test 1");
  await rateLimited.generate("test 2");
  await rateLimited.generate("test 3");

  // Verify all calls went through
  assertEquals((mockProvider.generate as Spy).calls.length, 3);
});

Deno.test("RateLimitedProvider: blocks calls over minute limit", async () => {
  const mockProvider = createMockProvider();
  const rateLimited = new RateLimitedProvider(mockProvider, {
    maxCallsPerMinute: 2,
    maxTokensPerHour: 10000,
    maxCostPerDay: 10,
    costPer1kTokens: 0.03,
  });

  // First two calls should succeed
  await rateLimited.generate("test 1");
  await rateLimited.generate("test 2");

  // Third call should fail
  await assertRejects(
    () => rateLimited.generate("test 3"),
    RateLimitError,
    "calls per minute",
  );

  // Verify only 2 calls went through
  assertEquals((mockProvider.generate as Spy).calls.length, 2);
});

Deno.test("RateLimitedProvider: estimates and tracks cost", async () => {
  const mockProvider = createMockProvider();
  const rateLimited = new RateLimitedProvider(mockProvider, {
    maxCallsPerMinute: 10,
    maxTokensPerHour: 10000,
    maxCostPerDay: 0.01, // $0.01 limit - very low
    costPer1kTokens: 0.03, // $0.03 per 1k tokens
  });

  // Large prompt that would exceed cost limit
  // 50000 chars = ~12500 tokens = (12500/1000)*0.03 = $0.375
  const largePrompt = "X".repeat(50000);

  await assertRejects(
    () => rateLimited.generate(largePrompt),
    RateLimitError,
    "Cost limit exceeded",
  );

  // Verify no calls went through
  assertEquals((mockProvider.generate as Spy).calls.length, 0);
});

Deno.test("RateLimitedProvider: rolls back on error", async () => {
  const errorProvider = createErrorProvider(new Error("API Error"));
  const rateLimited = new RateLimitedProvider(errorProvider, {
    maxCallsPerMinute: 10,
    maxTokensPerHour: 10000,
    maxCostPerDay: 10,
    costPer1kTokens: 0.03,
  });

  await assertRejects(() => rateLimited.generate("test"));

  // Verify counters were reset (callsThisMinute should be 0)
  assertEquals(rateLimited.callsThisMinute, 0);
  assertEquals(rateLimited.tokensThisHour, 0);
});

Deno.test("RateLimitedProvider: resets windows correctly", async () => {
  const mockProvider = createMockProvider();
  const rateLimited = new RateLimitedProvider(mockProvider, {
    maxCallsPerMinute: 1,
    maxTokensPerHour: 10000,
    maxCostPerDay: 10,
    costPer1kTokens: 0.03,
  });

  // Make one call
  await rateLimited.generate("test");

  // Simulate time passing (61 seconds)
  rateLimited.windowStart = Date.now() - 61000;
  rateLimited.resetWindowsIfNeeded();

  // Should allow another call
  await rateLimited.generate("test");
  assertEquals((mockProvider.generate as Spy).calls.length, 2);
});

Deno.test("RateLimitedProvider: enforces token limits per hour", async () => {
  const mockProvider = createMockProvider();
  const rateLimited = new RateLimitedProvider(mockProvider, {
    maxCallsPerMinute: 10,
    maxTokensPerHour: 500, // Very low limit for testing
    maxCostPerDay: 10,
    costPer1kTokens: 0.03,
  });

  // First call with small prompt should succeed
  await rateLimited.generate("short");

  // Second call with large prompt should fail due to token limit
  const largePrompt = "X".repeat(2000); // ~500 tokens, should exceed remaining limit
  await assertRejects(
    () => rateLimited.generate(largePrompt),
    RateLimitError,
    "tokens per hour",
  );
});

Deno.test("RateLimitedProvider: provides detailed error messages", async () => {
  const mockProvider = createMockProvider();
  const rateLimited = new RateLimitedProvider(mockProvider, {
    maxCallsPerMinute: 1,
    maxTokensPerHour: 10000,
    maxCostPerDay: 10,
    costPer1kTokens: 0.03,
  });

  // Exceed calls per minute
  await rateLimited.generate("test");
  try {
    await rateLimited.generate("test");
    throw new Error("Should have thrown");
  } catch (error) {
    if (!(error instanceof RateLimitError)) {
      throw error;
    }
    assertStringIncludes((error as RateLimitError).message, "calls per minute");
  }
});

Deno.test("RateLimitedProvider: handles concurrent requests correctly", async () => {
  const mockProvider = createMockProvider();
  const rateLimited = new RateLimitedProvider(mockProvider, {
    maxCallsPerMinute: 2,
    maxTokensPerHour: 10000,
    maxCostPerDay: 10,
    costPer1kTokens: 0.03,
  });

  // Start two concurrent requests
  const promise1 = rateLimited.generate("test 1");
  const promise2 = rateLimited.generate("test 2");

  // Both should succeed
  await Promise.all([promise1, promise2]);
  assertEquals((mockProvider.generate as Spy).calls.length, 2);

  // Third concurrent request should fail
  await assertRejects(
    () => rateLimited.generate("test 3"),
    RateLimitError,
  );
});

Deno.test("RateLimitedProvider: resets daily cost counter", async () => {
  const mockProvider = createMockProvider();
  const rateLimited = new RateLimitedProvider(mockProvider, {
    maxCallsPerMinute: 10,
    maxTokensPerHour: 10000,
    maxCostPerDay: 1, // $1 limit
    costPer1kTokens: 0.03,
  });

  // Simulate high cost usage
  rateLimited.costThisDay = 0.8; // Near limit

  // Simulate day change
  rateLimited.dayStart = Date.now() - 86_400_000; // 24+ hours ago
  rateLimited.resetWindowsIfNeeded();

  // Should allow call now
  await rateLimited.generate("test");
  assertEquals((mockProvider.generate as Spy).calls.length, 1);
});

Deno.test("RateLimitedProvider: records cost via tracker using provider name", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const costTracker = new CostTracker(db);
    const mockProvider: IModelProvider = {
      id: "openai-gpt-4",
      generate: spy(() => Promise.resolve("ok")),
    };

    const rateLimited = new RateLimitedProvider(mockProvider, {
      maxCallsPerMinute: 10,
      maxTokensPerHour: 10000,
      maxCostPerDay: 10,
      costPer1kTokens: 0.001,
      costTracker,
    });

    await rateLimited.generate("hello");
    await costTracker.flush();

    const openAiCost = await costTracker.getDailyCost(PROVIDER_OPENAI);
    const mockCost = await costTracker.getDailyCost("mock");

    assert(openAiCost > 0);
    assertEquals(mockCost, 0);
    assertEquals((mockProvider.generate as Spy).calls.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("RateLimitedProvider: blocks when persistent budget exceeded", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const costTracker = new CostTracker(db);
    await costTracker.trackRequest(PROVIDER_OPENAI, 1000);
    await costTracker.flush();

    const mockProvider: IModelProvider = {
      id: "openai-gpt-4",
      generate: spy(() => Promise.resolve("ok")),
    };

    const rateLimited = new RateLimitedProvider(mockProvider, {
      maxCallsPerMinute: 10,
      maxTokensPerHour: 10000,
      maxCostPerDay: 0.001,
      costPer1kTokens: 0.0001,
      costTracker,
    });

    await assertRejects(
      () => rateLimited.generate("tiny"),
      RateLimitError,
      "Persistent cost budget exceeded for " + PROVIDER_OPENAI,
    );

    assertEquals((mockProvider.generate as Spy).calls.length, 0);
  } finally {
    await cleanup();
  }
});
