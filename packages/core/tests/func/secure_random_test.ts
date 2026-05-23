/**
 * @module SecureRandomTest
 * @path packages/core/tests/func/secure_random_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Verifies secure random utilities exposed through @exaix/core/func.
 */

import { assert, assertEquals, assertFalse, assertMatch, assertNotEquals } from "@std/assert";
import { SecureRandom } from "@exaix/core/func";

Deno.test("[SecureRandom] generates cryptographically secure bytes", () => {
  const bytes = SecureRandom.getRandomBytes(32);
  assertEquals(bytes.length, 32);
  assert(bytes instanceof Uint8Array);
  assertFalse(bytes.every((b) => b === 0));
});

Deno.test("[SecureRandom] generates URL-safe random strings", () => {
  const str = SecureRandom.getRandomString(16);
  assertEquals(str.length, 16);
  assertMatch(str, /^[A-Za-z0-9_-]+$/);
});

Deno.test("[SecureRandom] generates unique IDs", () => {
  const id1 = SecureRandom.generateId();
  const id2 = SecureRandom.generateId();
  assertNotEquals(id1, id2);
  assert(id1.length > 10);
  assert(id2.length > 10);
});

Deno.test("[SecureRandom] generates valid UUIDs", () => {
  const uuid = SecureRandom.generateUUID();
  assertMatch(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

Deno.test("[SecureRandom] generates secure random numbers", () => {
  const num1 = SecureRandom.getRandomNumber();
  const num2 = SecureRandom.getRandomNumber();
  assertNotEquals(num1, num2);
  assert(num1 >= 0 && num1 < 1);
  assert(num2 >= 0 && num2 < 1);
});

Deno.test("[SecureRandom] generates random integers in range", () => {
  const min = 10;
  const max = 100;
  const randomInt = SecureRandom.getRandomInt(min, max);
  assert(randomInt >= min && randomInt <= max);
  assert(Number.isInteger(randomInt));
});

Deno.test("[SecureRandom] generates secure tokens", () => {
  const token1 = SecureRandom.generateToken(32);
  const token2 = SecureRandom.generateToken(32);
  assertNotEquals(token1, token2);
  assertEquals(token1.length, 64);
  assertMatch(token1, /^[0-9a-f]+$/);
  assertMatch(token2, /^[0-9a-f]+$/);
});

Deno.test("[SecureRandom] generates prefixed IDs", () => {
  const id = SecureRandom.generateId("test");
  assert(id.startsWith("test_"));
  assert(id.length > 5);
});

Deno.test("[SecureRandom] generates session IDs", () => {
  const sessionId = SecureRandom.generateSessionId();
  assert(sessionId.length > 20);
  assertMatch(sessionId, /^[A-Za-z0-9_-]+$/);
});
