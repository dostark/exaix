/**
 * @module CircuitBreakerTest
 * @path packages/ai/tests/circuit_breaker_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Tests for the CircuitBreaker resilience pattern, verifying state transitions
 * (Closed -> Open -> Half-Open) based on error thresholds and recovery timeouts.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { CircuitBreaker } from "@exaix/ai/circuit_breaker.ts";
import { RateLimiterError } from "@exaix/ai/rate_limited_provider.ts";
Deno.test("CircuitBreaker opens after failure threshold and recovers", async () => {
  const cb = new CircuitBreaker({
    failureThreshold: 2,
    resetTimeout: 100, // short timeout for test
    halfOpenSuccessThreshold: 1,
  });

  // first failing call
  await assertRejects(() => cb.execute(() => Promise.reject(new Error("fail1"))));

  // second failing call should open the circuit
  await assertRejects(() => cb.execute(() => Promise.reject(new Error("fail2"))));

  // Circuit should now be open
  assertEquals(cb.getState(), "open");

  // Immediate call should reject due to open circuit
  await assertRejects(() => cb.execute(() => Promise.resolve("ok")));

  // Wait past resetTimeout to allow half-open
  await new Promise((r) => setTimeout(r, 150));

  // Now a successful call should transition to closed
  const res = await cb.execute(() => Promise.resolve("recovered"));
  assertEquals(res, "recovered");
  assertEquals(cb.getState(), "closed");
});

Deno.test("CircuitBreaker does NOT open on RateLimiterError (backpressure, not a provider fault)", async () => {
  // A local throttle rejection is expected backpressure — it must not be counted
  // toward opening the breaker, or a burst of self-throttled calls would starve
  // every subsequent request.
  const cb = new CircuitBreaker({
    failureThreshold: 2,
    resetTimeout: 100,
    halfOpenSuccessThreshold: 1,
  });

  for (let i = 0; i < 5; i++) {
    await assertRejects(
      () => cb.execute(() => Promise.reject(new RateLimiterError("Rate limit exceeded: 1 calls per minute"))),
      RateLimiterError,
    );
  }

  // Despite 5 rate-limit rejections (> threshold), the circuit stays CLOSED.
  assertEquals(cb.getState(), "closed", "rate-limit rejections must not open the breaker");
  assertEquals(cb.getFailureCount(), 0, "rate-limit rejections must not increment the failure count");

  // A genuine fault still counts and opens the breaker.
  await assertRejects(() => cb.execute(() => Promise.reject(new Error("real transport fault"))));
  await assertRejects(() => cb.execute(() => Promise.reject(new Error("real transport fault"))));
  assert(cb.getState() === "open", "genuine faults still open the breaker");
});

class ContentError extends Error {}

Deno.test("CircuitBreaker honors a caller-supplied isCountableFailure predicate", () => {
  // The caller (e.g. the request processor's I/O breaker) decides which errors are
  // infrastructure faults. A content-validation failure (bad LLM output) is per-request and
  // must NOT open a cross-request breaker, or one bad response starves every following request.
  const cb = new CircuitBreaker({
    failureThreshold: 2,
    resetTimeout: 100,
    halfOpenSuccessThreshold: 1,
    isCountableFailure: (e) => !(e instanceof ContentError),
  });

  return (async () => {
    for (let i = 0; i < 5; i++) {
      await assertRejects(() => cb.execute(() => Promise.reject(new ContentError("missing field"))), ContentError);
    }
    assertEquals(cb.getState(), "closed", "non-countable content errors must not open the breaker");
    assertEquals(cb.getFailureCount(), 0);

    // A countable (infrastructure) error still opens it.
    await assertRejects(() => cb.execute(() => Promise.reject(new Error("disk full"))));
    await assertRejects(() => cb.execute(() => Promise.reject(new Error("disk full"))));
    assertEquals(cb.getState(), "open", "countable faults still open the breaker");
  })();
});
