/**
 * @module MemoryStatusParsingTest
 * @path packages/core/tests/memory_status_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Verifies memory status enums, ensuring correct validation and
 * resilient coercion of dynamic learning states.
 */

import { assertEquals } from "@std/assert";

import { coerceMemoryStatus } from "@exaix/core/status";
import { isMemoryStatus, MEMORY_STATUS_VALUES, MemoryStatus } from "@exaix/core/status";

Deno.test("isMemoryStatus: accepts known values", () => {
  for (const status of MEMORY_STATUS_VALUES) {
    assertEquals(isMemoryStatus(status), true);
  }
});

Deno.test("isMemoryStatus: rejects unknown and non-strings", () => {
  assertEquals(isMemoryStatus("nope"), false);
  assertEquals(isMemoryStatus(123), false);
  assertEquals(isMemoryStatus(null), false);
  assertEquals(isMemoryStatus(undefined), false);
});

Deno.test("coerceMemoryStatus: returns fallback for invalid values", () => {
  assertEquals(coerceMemoryStatus("nope"), MemoryStatus.PENDING);
  assertEquals(coerceMemoryStatus(123, MemoryStatus.REJECTED), MemoryStatus.REJECTED);
});

Deno.test("coerceMemoryStatus: passes through valid values", () => {
  assertEquals(coerceMemoryStatus(MemoryStatus.APPROVED), MemoryStatus.APPROVED);
});
