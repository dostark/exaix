/**
 * @module MemoryTUIScopeTest
 * @path apps/tui/tests/memory_scope_test.ts
 * @description Verifies the logic for handling memory scopes (Project vs Global) within the TUI,
 * ensuring correct coercion and validation of user-selected viewing contexts.
 */

import { assertEquals } from "@std/assert";

import { coerceMemoryTuiScope, isMemoryTuiScope, MemoryTuiScope } from "../src/memory_view/memory_scope.ts";

Deno.test("isMemoryTuiScope: accepts known values", () => {
  assertEquals(isMemoryTuiScope(MemoryTuiScope.GLOBAL), true);
  assertEquals(isMemoryTuiScope(MemoryTuiScope.PROJECTS), true);
  assertEquals(isMemoryTuiScope(MemoryTuiScope.EXECUTIONS), true);
  assertEquals(isMemoryTuiScope(MemoryTuiScope.PENDING), true);
  assertEquals(isMemoryTuiScope(MemoryTuiScope.SEARCH), true);
});

Deno.test("isMemoryTuiScope: rejects unknown and non-strings", () => {
  assertEquals(isMemoryTuiScope("nope"), false);
  assertEquals(isMemoryTuiScope(123), false);
  assertEquals(isMemoryTuiScope(null), false);
  assertEquals(isMemoryTuiScope(undefined), false);
});

Deno.test("coerceMemoryTuiScope: returns fallback for invalid values", () => {
  assertEquals(coerceMemoryTuiScope("nope"), MemoryTuiScope.PROJECTS);
  assertEquals(coerceMemoryTuiScope(123, MemoryTuiScope.GLOBAL), MemoryTuiScope.GLOBAL);
});

Deno.test("coerceMemoryTuiScope: passes through valid values", () => {
  assertEquals(coerceMemoryTuiScope(MemoryTuiScope.SEARCH), MemoryTuiScope.SEARCH);
});
