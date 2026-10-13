/**
 * @module AICommonProviderTest
 * @path packages/ai/tests/providers/common_provider_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Verifies shared LLM provider utilities, including robust retry logic,
 * exponential backoff, and identification of transient vs. terminal errors.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { DEFAULT_AI_RETRY_AFTER_MAX_MS } from "@exaix/core/types";
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

/** A rate-limit error that carries the provider's Retry-After value, as the OpenRouter error classes do. */
class RetryAfterError extends RateLimitError {
  constructor(readonly retryAfterMs: number) {
    super("test", "Rate limit with Retry-After");
    Object.setPrototypeOf(this, RetryAfterError.prototype);
  }
}

const RETRY_AFTER_MS = 5_000;

function failsOnceThenSucceeds(retryAfterMs: number): { fn: () => Promise<string>; calls: () => number } {
  let calls = 0;
  return {
    fn: () => {
      calls++;
      return calls === 1 ? Promise.reject(new RetryAfterError(retryAfterMs)) : Promise.resolve("ok");
    },
    calls: () => calls,
  };
}

Deno.test("withRetry - waits at least retryAfterMs before the next attempt", async () => {
  const time = new FakeTime();
  try {
    const probe = failsOnceThenSucceeds(RETRY_AFTER_MS);
    const result = withRetry(probe.fn, { maxRetries: 2, baseDelayMs: 1 });
    await time.tickAsync(RETRY_AFTER_MS - 1);
    assertEquals(probe.calls(), 1, "the retry must wait for Retry-After, not the 1 ms backoff");
    await time.tickAsync(1);
    assertEquals(await result, "ok");
    assertEquals(probe.calls(), 2);
  } finally {
    time.restore();
  }
});

Deno.test("withRetry - a retryAfterMs over the cap waits the cap", async () => {
  const time = new FakeTime();
  try {
    const probe = failsOnceThenSucceeds(DEFAULT_AI_RETRY_AFTER_MAX_MS * 10);
    const result = withRetry(probe.fn, { maxRetries: 2, baseDelayMs: 1 });
    await time.tickAsync(DEFAULT_AI_RETRY_AFTER_MAX_MS - 1);
    assertEquals(probe.calls(), 1);
    await time.tickAsync(1);
    assertEquals(await result, "ok");
  } finally {
    time.restore();
  }
});

Deno.test("withRetry - an abort during a Retry-After wait rejects at once", async () => {
  const time = new FakeTime();
  try {
    const controller = new AbortController();
    const probe = failsOnceThenSucceeds(RETRY_AFTER_MS);
    const result = withRetry(probe.fn, { maxRetries: 2, baseDelayMs: 1, signal: controller.signal });
    const settled = assertRejects(() => result, DOMException, "aborted");
    await time.tickAsync(1);
    controller.abort();
    await settled;
    assertEquals(probe.calls(), 1);
  } finally {
    time.restore();
  }
});

Deno.test("withRetry - onRetry receives each scheduled retry with its delay and error", async () => {
  const time = new FakeTime();
  try {
    const seen: Array<{ attempt: number; delayMs: number; error: Error }> = [];
    const probe = failsOnceThenSucceeds(RETRY_AFTER_MS);
    const result = withRetry(probe.fn, {
      maxRetries: 3,
      baseDelayMs: 1,
      onRetry: (attempt, delayMs, error) => {
        seen.push({ attempt, delayMs, error });
      },
    });
    await time.tickAsync(RETRY_AFTER_MS);
    await result;
    assertEquals(seen.length, 1);
    assertEquals(seen[0].attempt, 1);
    assertEquals(seen[0].delayMs, RETRY_AFTER_MS);
    assert(seen[0].error instanceof RetryAfterError);
  } finally {
    time.restore();
  }
});

Deno.test("withRetry - onRetry is not called after the last attempt", async () => {
  const seen: number[] = [];
  await assertRejects(
    () =>
      withRetry(() => Promise.reject(new RateLimitError("test", "x")), {
        maxRetries: 2,
        baseDelayMs: 1,
        onRetry: (attempt) => {
          seen.push(attempt);
        },
      }),
    RateLimitError,
  );
  assertEquals(seen, [1]);
});
