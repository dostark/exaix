/**
 * @module SecureRandomTest
 * @path tests/utils/secure_random_test.ts
 * @description Verifies the project's secure random utilities, ensuring
 * cryptographically strong generation of bytes, strings, and unique identifiers.
 */

import { assert, assertEquals, assertFalse, assertMatch, assertNotEquals } from "@std/assert";
import { SecureRandom } from "../../src/helpers/secure_random.ts";

Deno.test("SecureRandom: generates cryptographically secure bytes", () => {
  const bytes = SecureRandom.getRandomBytes(32);
  assertEquals(bytes.length, 32);
  assert(bytes instanceof Uint8Array);
  // Check that not all bytes are zero (very unlikely for random data)
  assertFalse(bytes.every((b) => b === 0));
});

Deno.test("SecureRandom: generates URL-safe random strings", () => {
  const str = SecureRandom.getRandomString(16);
  assertEquals(str.length, 16);
  // Should only contain URL-safe characters
  assertMatch(str, /^[A-Za-z0-9_-]+$/);
});

Deno.test("SecureRandom: generates unique IDs", () => {
  const id1 = SecureRandom.generateId();
  const id2 = SecureRandom.generateId();
  assertNotEquals(id1, id2);
  // Should be reasonable length
  assert(id1.length > 10);
  assert(id2.length > 10);
});

Deno.test("SecureRandom: generates valid UUIDs", () => {
  const uuid = SecureRandom.generateUUID();
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  assertMatch(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

Deno.test("SecureRandom: generates secure random numbers", () => {
  const num1 = SecureRandom.getRandomNumber();
  const num2 = SecureRandom.getRandomNumber();
  assertNotEquals(num1, num2);
  // Should be between 0 and 1
  assert(num1 >= 0 && num1 < 1);
  assert(num2 >= 0 && num2 < 1);
});

Deno.test("SecureRandom: generates random integers in range", () => {
  const min = 10;
  const max = 100;
  const randomInt = SecureRandom.getRandomInt(min, max);
  assert(randomInt >= min && randomInt <= max);
  assert(Number.isInteger(randomInt));
});

Deno.test("SecureRandom: generates secure tokens", () => {
  const token1 = SecureRandom.generateToken(32);
  const token2 = SecureRandom.generateToken(32);
  assertNotEquals(token1, token2);
  assertEquals(token1.length, 64); // 32 bytes * 2 for hex
  assertMatch(token1, /^[0-9a-f]+$/);
  assertMatch(token2, /^[0-9a-f]+$/);
});

Deno.test("SecureRandom: generates prefixed IDs", () => {
  const id = SecureRandom.generateId("test");
  assert(id.startsWith("test_"));
  assert(id.length > 5); // "test_" + some random part
});

Deno.test("SecureRandom: generates session IDs", () => {
  const sessionId = SecureRandom.generateSessionId();
  assert(sessionId.length > 20);
  // Should be URL-safe
  assertMatch(sessionId, /^[A-Za-z0-9_-]+$/);
});
