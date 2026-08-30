/**
 * @module ExaCtlFallbackTest
 * @path apps/exactl/tests/exactl_fallback_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Verifies the CLI's resilience during initialization failures, ensuring safe
 * fallbacks for database and configuration modules to prevent terminal crashes.
 */

import { assert, assertEquals } from "@std/assert";
import { __test_initializeServices } from "../src/exactl.ts";

/** Regression test: fallback DB stub must include queryActivity to avoid a crash on missing config. */
Deno.test("CLI: should provide safe fallback DB when initialization fails", async () => {
  // Simulate service initialization failure (e.g. missing config)
  const result = await __test_initializeServices({ simulateFail: true });

  assert(!result.success, "Should report failure");
  assert(result.db, "Should return a db stub");

  // Verify queryActivity exists and returns empty array instead of crashing
  // This was the cause of "TypeError: db.queryActivity is not a function"
  assert(typeof result.db.queryActivity === "function", "db.queryActivity should be a function");

  const activities = await result.db.queryActivity({});
  assert(Array.isArray(activities), "Should return an array");
  assertEquals(activities.length, 0, "Should return empty array");
});
