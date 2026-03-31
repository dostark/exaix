/**
 * @module CircuitBreakerTest
 * @path tests/services/ai/circuit_breaker_test.ts
 * @description Tests for the CircuitBreaker resilience pattern, verifying state transitions
 * (Closed -> Open -> Half-Open) based on error thresholds and recovery timeouts.
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.200.0/testing/asserts.ts";
import { CircuitBreaker } from "../../../src/ai/circuit_breaker.ts";

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
