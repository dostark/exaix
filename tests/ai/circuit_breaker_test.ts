/**
 * @module AICircuitBreakerTest
 * @path tests/ai/circuit_breaker_test.ts
 * @description Verifies the CircuitBreaker resilience pattern for AI providers,
 * ensuring stable state transitions based on failure thresholds and recovery windows.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { EvaluationVerdict } from "../../src/shared/enums.ts";
import { CircuitBreaker, CircuitBreakerProvider } from "../../src/ai/circuit_breaker.ts";
import type { IModelOptions } from "../../src/ai/types.ts";
import type { IGenerateResult } from "../../src/ai/providers/common.ts";

function makeResult(content: string): IGenerateResult {
  return {
    content,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    model: "m",
    provider: "p",
    cost_usd: 0,
  };
}

// ============================================================================
// Unit Tests for CircuitBreaker State Management
// ============================================================================

Deno.test("CircuitBreaker: starts in closed state", () => {
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    halfOpenSuccessThreshold: 2,
  });

  // Should allow requests initially
  assertEquals(breaker.getState(), "closed");
});

Deno.test("CircuitBreaker: opens after failure threshold", async () => {
  const breaker = new CircuitBreaker({
    failureThreshold: 2,
    resetTimeout: 1000,
    halfOpenSuccessThreshold: 1,
  });

  // Two failures should open the circuit
  await assertRejects(() => breaker.execute(() => Promise.reject(new Error(EvaluationVerdict.FAIL))));
  await assertRejects(() => breaker.execute(() => Promise.reject(new Error(EvaluationVerdict.FAIL))));

  // Third call should be rejected immediately
  await assertRejects(
    () => breaker.execute(() => Promise.resolve("success")),
    Error,
    "Circuit breaker is OPEN",
  );
});

Deno.test("CircuitBreaker: transitions to half-open after timeout", async () => {
  const breaker = new CircuitBreaker({
    failureThreshold: 1,
    resetTimeout: 50, // Short timeout for testing
    halfOpenSuccessThreshold: 1,
  });

  // Fail once to open circuit
  await assertRejects(() => breaker.execute(() => Promise.reject(new Error(EvaluationVerdict.FAIL))));

  // Wait for reset timeout
  await new Promise((r) => setTimeout(r, 60));

  // Should now be half-open and allow one request
  const result = await breaker.execute(() => Promise.resolve("success"));
  assertEquals(result, "success");
  assertEquals(breaker.getState(), "closed"); // Should close after success
});

Deno.test("CircuitBreaker: requires multiple successes in half-open state", async () => {
  const breaker = new CircuitBreaker({
    failureThreshold: 1,
    resetTimeout: 50,
    halfOpenSuccessThreshold: 2, // Requires 2 successes
  });

  // Fail once to open circuit
  await assertRejects(() => breaker.execute(() => Promise.reject(new Error(EvaluationVerdict.FAIL))));

  // Wait for reset timeout
  await new Promise((r) => setTimeout(r, 60));

  // First success in half-open state
  const result1 = await breaker.execute(() => Promise.resolve("success1"));
  assertEquals(result1, "success1");
  assertEquals(breaker.getState(), "half-open"); // Still half-open

  // Second success should close the circuit
  const result2 = await breaker.execute(() => Promise.resolve("success2"));
  assertEquals(result2, "success2");
  assertEquals(breaker.getState(), "closed");
});

Deno.test("CircuitBreaker: failure in half-open state reopens circuit", async () => {
  const breaker = new CircuitBreaker({
    failureThreshold: 1,
    resetTimeout: 50,
    halfOpenSuccessThreshold: 2,
  });

  // Fail once to open circuit
  await assertRejects(() => breaker.execute(() => Promise.reject(new Error(EvaluationVerdict.FAIL))));

  // Wait for reset timeout
  await new Promise((r) => setTimeout(r, 60));

  // Success in half-open state
  await breaker.execute(() => Promise.resolve("success"));
  assertEquals(breaker.getState(), "half-open");

  // Failure in half-open state should reopen circuit
  await assertRejects(() => breaker.execute(() => Promise.reject(new Error("fail again"))));
  assertEquals(breaker.getState(), "open");
});

Deno.test("CircuitBreaker: success in closed state resets failure count", async () => {
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    halfOpenSuccessThreshold: 1,
  });

  // One failure
  await assertRejects(() => breaker.execute(() => Promise.reject(new Error(EvaluationVerdict.FAIL))));
  assertEquals(breaker.getFailureCount(), 1);

  // Success should reset failure count
  await breaker.execute(() => Promise.resolve("success"));
  assertEquals(breaker.getFailureCount(), 0);
  assertEquals(breaker.getState(), "closed");
});

// ============================================================================
// Integration Tests with Provider Simulation
// ============================================================================

Deno.test("CircuitBreakerProvider: circuit breaker prevents cascade failures", async () => {
  let callCount = 0;
  const failingProvider = {
    id: "failing-provider",
    generate: () => {
      callCount++;
      return Promise.reject(new Error("API down"));
    },
  };

  const resilientProvider = new CircuitBreakerProvider(failingProvider, {
    failureThreshold: 5,
    resetTimeout: 100,
    halfOpenSuccessThreshold: 1,
  });

  // Multiple failures should eventually open circuit
  for (let i = 0; i < 6; i++) {
    await assertRejects(() => resilientProvider.generate("test"));
  }

  // Circuit should be open, no more calls to underlying provider
  const beforeOpenCalls = callCount;
  await assertRejects(() => resilientProvider.generate("test"));
  assertEquals(callCount, beforeOpenCalls); // No additional calls
  assertEquals(resilientProvider.getCircuitState(), "open");
});

Deno.test("CircuitBreakerProvider: recovers after service restoration", async () => {
  let shouldFail = true;
  const unreliableProvider = {
    id: "unreliable-provider",
    generate: () => {
      if (shouldFail) {
        return Promise.reject(new Error("Service temporarily down"));
      }
      return Promise.resolve(makeResult("Recovered response"));
    },
  };

  const resilientProvider = new CircuitBreakerProvider(unreliableProvider, {
    failureThreshold: 2,
    resetTimeout: 50,
    halfOpenSuccessThreshold: 1,
  });

  // Cause circuit to open
  for (let i = 0; i < 3; i++) {
    await assertRejects(() => resilientProvider.generate("test"));
  }
  assertEquals(resilientProvider.getCircuitState(), "open");

  // Wait for half-open transition
  await new Promise((r) => setTimeout(r, 60));

  // Service recovers
  shouldFail = false;

  // Should eventually succeed
  const result = await resilientProvider.generate("test");
  assertEquals(result.content, "Recovered response");
  assertEquals(resilientProvider.getCircuitState(), "closed");
});

Deno.test("CircuitBr(e)akerProvider: preserves successful responses", async () => {
  const mockProvider = {
    id: "mock-provider",
    generate: () => Promise.resolve(makeResult("Success response")),
  };

  const resilientProvider = new CircuitBreakerProvider(mockProvider);

  const result = await resilientProvider.generate("test prompt");
  assertEquals(result.content, "Success response");
  assertEquals(resilientProvider.getCircuitState(), "closed");
  assertEquals(resilientProvider.getFailureCount(), 0);
});

Deno.test("CircuitBreakerProvider: forwards options to inner provider", async () => {
  let receivedOptions: IModelOptions | undefined = undefined;
  const mockProvider = {
    id: "mock-provider",
    generate: (_prompt: string, options?: IModelOptions): Promise<IGenerateResult> => {
      receivedOptions = options;
      return Promise.resolve(makeResult("Response"));
    },
  };

  const resilientProvider = new CircuitBreakerProvider(mockProvider);
  const testOptions = { temperature: 0.5, maxTokens: 100 };

  await resilientProvider.generate("test", testOptions);

  assertEquals(receivedOptions, testOptions);
});

Deno.test("CircuitBreakerProvider: generates correct ID", () => {
  const mockProvider = {
    id: "test-provider",
    generate: (): Promise<IGenerateResult> => Promise.resolve(makeResult("response")),
  };

  const resilientProvider = new CircuitBreakerProvider(mockProvider);

  assertEquals(resilientProvider.id, "circuit-breaker-test-provider");
});
