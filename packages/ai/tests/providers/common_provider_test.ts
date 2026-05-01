/**
 * @module AICommonProviderTest
 * @path tests/ai/common_provider_test.ts
 * @description Verifies shared LLM provider utilities, including robust retry logic,
 * exponential backoff, and identification of transient vs. terminal errors.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { AuthenticationError, isRetryable, RateLimitError, withRetry } from "../../src/providers/common.ts";

Deno.test("isRetryable - identifies retryable errors", () => {
  assertEquals(isRetryable(new RateLimitError("openai", "Too many requests")), true);
  assertEquals(isRetryable(new AuthenticationError("openai", "Invalid key")), false);
  assertEquals(isRetryable(new Error("Network error")), true);
});

Deno.test("withRetry - retries on retryable errors", async () => {
  let callCount = 0;
  const fn = () => {
    callCount++;
    if (callCount < 3) {
      return Promise.reject(new RateLimitError("test", "Rate limit"));
    }
    return Promise.resolve("success");
  };

  const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
  assertEquals(result, "success");
  assertEquals(callCount, 3);
});

Deno.test("withRetry - fails after max retries", async () => {
  let callCount = 0;
  const fn = () => {
    callCount++;
    return Promise.reject(new RateLimitError("test", "Rate limit"));
  };

  await assertRejects(
    () => withRetry(fn, { maxRetries: 3, baseDelayMs: 1 }),
    RateLimitError,
    "Rate limit",
  );
  assertEquals(callCount, 3);
});

Deno.test("withRetry - does not retry on non-retryable errors", async () => {
  let callCount = 0;
  const fn = () => {
    callCount++;
    throw new AuthenticationError("test", "Invalid key");
  };

  await assertRejects(
    () => withRetry(fn, { maxRetries: 3, baseDelayMs: 1 }),
    AuthenticationError,
    "Invalid key",
  );
  assertEquals(callCount, 1);
});
