/**
 * @module RetryPolicyTest
 * @path tests/services/ai/retry_policy_test.ts
 * @description Verifies the resilience logic for AI provider calls, ensuring correct
 * exponential backoff, retryable error classification, and maximum attempt enforcement.
 */

import { assert, assertEquals, assertExists, assertGreater, assertLess } from "@std/assert";
import {
  createAPIRetryPolicy,
  createLLMRetryPolicy,
  createRetryPolicy,
  type IRetryContext,
  RetryPolicy,
} from "@exaix/core/request";
// ============================================================================
// RetryPolicy.execute() Tests
// ============================================================================

Deno.test("[RetryPolicy] succeeds on first attempt", async () => {
  const policy = new RetryPolicy({ maxRetries: 3 });
  let callCount = 0;

  const result = await policy.execute(() => {
    callCount++;
    return Promise.resolve("success");
  });

  assert(result.success);
  assertEquals(result.value, "success");
  assertEquals(result.totalAttempts, 1);
  assertEquals(callCount, 1);
  assertEquals(result.retryHistory.length, 0);
});

Deno.test("[RetryPolicy] retries on retryable error", async () => {
  const policy = new RetryPolicy({
    maxRetries: 3,
    initialDelayMs: 10,
  });
  let callCount = 0;

  const result = await policy.execute(() => {
    callCount++;
    if (callCount < 3) {
      return Promise.reject(new Error("rate limit exceeded"));
    }
    return Promise.resolve("success after retries");
  });

  assert(result.success);
  assertEquals(result.value, "success after retries");
  assertEquals(result.totalAttempts, 3);
  assertEquals(callCount, 3);
  assertEquals(result.retryHistory.length, 2);
});

Deno.test("[RetryPolicy] fails after max retries", async () => {
  const policy = new RetryPolicy({
    maxRetries: 2,
    initialDelayMs: 10,
  });
  let callCount = 0;

  const result = await policy.execute(() => {
    callCount++;
    return Promise.reject(new Error("timeout error"));
  });

  assert(!result.success);
  assertExists(result.error);
  assertEquals(result.error.message, "timeout error");
  assertEquals(result.totalAttempts, 3);
  assertEquals(callCount, 3);
});

Deno.test("[RetryPolicy] does not retry non-retryable errors", async () => {
  const policy = new RetryPolicy({ maxRetries: 3 });
  let callCount = 0;

  const result = await policy.execute(() => {
    callCount++;
    return Promise.reject(new Error("invalid input"));
  });

  assert(!result.success);
  assertEquals(callCount, 1);
  assertEquals(result.totalAttempts, 1);
});

Deno.test("[RetryPolicy] retries on message pattern match", async () => {
  const policy = new RetryPolicy({
    maxRetries: 1,
    initialDelayMs: 10,
  });

  const patterns = [
    "rate limit exceeded",
    "connection timeout",
    "network error",
    "service unavailable",
    "HTTP 503",
    "HTTP 429",
  ];

  for (const pattern of patterns) {
    let callCount = 0;
    await policy.execute(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error(pattern));
      }
      return Promise.resolve("ok");
    });

    assertEquals(callCount, 2, `IPattern "${pattern}" should trigger retry`);
  }
});

// ============================================================================
// Exponential Backoff Tests
// ============================================================================

Deno.test("[RetryPolicy] calculates exponential backoff", () => {
  const policy = new RetryPolicy({
    initialDelayMs: 1000,
    backoffMultiplier: 2,
    maxDelayMs: 30000,
    jitterFactor: 0,
  });

  assertEquals(policy.calculateDelay(1), 1000);
  assertEquals(policy.calculateDelay(2), 2000);
  assertEquals(policy.calculateDelay(3), 4000);
  assertEquals(policy.calculateDelay(4), 8000);
});

Deno.test("[RetryPolicy] caps delay at maxDelayMs", () => {
  const policy = new RetryPolicy({
    initialDelayMs: 1000,
    backoffMultiplier: 2,
    maxDelayMs: 5000,
    jitterFactor: 0,
  });

  assertEquals(policy.calculateDelay(10), 5000);
});

Deno.test("[RetryPolicy] adds jitter to delay", () => {
  const policy = new RetryPolicy({
    initialDelayMs: 1000,
    backoffMultiplier: 2,
    maxDelayMs: 30000,
    jitterFactor: 0.5,
  });

  const delays = Array.from({ length: 10 }, () => policy.calculateDelay(1));

  for (const delay of delays) {
    assertGreater(delay, 999);
    assertLess(delay, 1501);
  }

  const uniqueDelays = new Set(delays);
  assertGreater(uniqueDelays.size, 1, "Jitter should produce variance");
});

// ============================================================================
// Temperature Adjustment Tests
// ============================================================================

Deno.test("[RetryPolicy] increases temperature on retry", async () => {
  const policy = new RetryPolicy({
    maxRetries: 3,
    initialDelayMs: 10,
    temperatureIncrement: 0.1,
    maxTemperature: 1.0,
  });

  const temperatures: number[] = [];

  await policy.execute(
    ({ temperature }: { temperature: number }) => {
      temperatures.push(temperature);
      if (temperatures.length < 3) {
        return Promise.reject(new Error("timeout"));
      }
      return Promise.resolve("ok");
    },
    { baseTemperature: 0.7 },
  );

  assertEquals(temperatures.length, 3);
  assertEquals(temperatures[0], 0.7);
  // Use approximate comparison due to floating point
  assertGreater(temperatures[1], 0.79);
  assertLess(temperatures[1], 0.81);
  assertGreater(temperatures[2], 0.89);
  assertLess(temperatures[2], 0.91);
});

Deno.test("[RetryPolicy] caps temperature at maxTemperature", async () => {
  const policy = new RetryPolicy({
    maxRetries: 5,
    initialDelayMs: 10,
    temperatureIncrement: 0.5,
    maxTemperature: 1.0,
  });

  const temperatures: number[] = [];

  await policy.execute(
    ({ temperature }: { temperature: number }) => {
      temperatures.push(temperature);
      if (temperatures.length < 5) {
        return Promise.reject(new Error("timeout"));
      }
      return Promise.resolve("ok");
    },
    { baseTemperature: 0.7 },
  );

  assertEquals(temperatures[0], 0.7);
  assertEquals(temperatures[1], 1.0);
  assertEquals(temperatures[2], 1.0);
});

// ============================================================================
// Retry Callback Tests
// ============================================================================

Deno.test("[RetryPolicy] calls onRetry callback", async () => {
  const policy = new RetryPolicy({
    maxRetries: 2,
    initialDelayMs: 10,
  });

  const retryContexts: { attempt: number }[] = [];

  policy.setOnRetry((ctx: IRetryContext) => {
    retryContexts.push({ attempt: ctx.attempt });
  });

  await policy.execute(() => {
    return Promise.reject(new Error("timeout"));
  });

  assertEquals(retryContexts.length, 2);
  assertEquals(retryContexts[0].attempt, 1);
  assertEquals(retryContexts[1].attempt, 2);
});

// ============================================================================
// Abort Signal Tests
// ============================================================================

Deno.test("[RetryPolicy] respects abort signal", async () => {
  const policy = new RetryPolicy({
    maxRetries: 5,
    initialDelayMs: 100,
  });

  const controller = new AbortController();
  let callCount = 0;

  setTimeout(() => controller.abort(), 50);

  const result = await policy.execute(
    () => {
      callCount++;
      return Promise.reject(new Error("timeout"));
    },
    { signal: controller.signal },
  );

  assert(!result.success);
  assertEquals(result.error?.message, "Operation aborted");
  assertLess(callCount, 5);
});

// ============================================================================
// Factory Function Tests
// ============================================================================

Deno.test("[createRetryPolicy] creates policy with defaults", () => {
  const policy = createRetryPolicy();
  const config = policy.getConfig();

  assertEquals(config.maxRetries, 3);
  assertEquals(config.initialDelayMs, 1000);
  assertEquals(config.backoffMultiplier, 2);
});

Deno.test("[createLLMRetryPolicy] creates LLM-optimized policy", () => {
  const policy = createLLMRetryPolicy();
  const config = policy.getConfig();

  assertEquals(config.maxRetries, 3);
  assertEquals(config.temperatureIncrement, 0.1);
  assertEquals(config.maxTemperature, 1.2);
});

Deno.test("[createAPIRetryPolicy] creates API-optimized policy", () => {
  const policy = createAPIRetryPolicy();
  const config = policy.getConfig();

  assertEquals(config.maxRetries, 5);
  assertEquals(config.temperatureIncrement, 0);
  assertEquals(config.initialDelayMs, 500);
});

// ============================================================================
// isRetryable Tests
// ============================================================================

Deno.test("[RetryPolicy] isRetryable identifies retryable errors", () => {
  const policy = new RetryPolicy();

  assert(policy.isRetryable(new Error("HTTP 429 Too Many Requests")));
  assert(policy.isRetryable(new Error("connection reset")));
  assert(policy.isRetryable(new Error("socket hang up")));
  assert(policy.isRetryable(new Error("rate limit exceeded")));
  assert(policy.isRetryable(new Error("timeout error")));
  assert(policy.isRetryable(new Error("network failure")));

  assert(!policy.isRetryable(new Error("invalid input")));
  assert(!policy.isRetryable(new Error("authentication failed")));
});

// ============================================================================
// Edge Cases
// ============================================================================

Deno.test("[RetryPolicy] handles maxRetries = 0", async () => {
  const policy = new RetryPolicy({ maxRetries: 0 });
  let callCount = 0;

  const result = await policy.execute(() => {
    callCount++;
    return Promise.reject(new Error("timeout"));
  });

  assert(!result.success);
  assertEquals(callCount, 1);
  assertEquals(result.totalAttempts, 1);
});

Deno.test("[RetryPolicy] tracks timing correctly", async () => {
  const policy = new RetryPolicy({
    maxRetries: 2,
    initialDelayMs: 50,
  });

  const result = await policy.execute(() => {
    return Promise.reject(new Error("timeout"));
  });

  assertGreater(result.totalTimeMs, 100);
});
