/**
 * @module TestingPackageDbHelpersTest
 * @path packages/testing/tests/db_helpers_test.ts
 * @description Verifies shared test DB helpers in @exaix/testing.
 */
import { assertEquals } from "@std/assert";
import { createLoggingTestDb } from "@exaix/testing/helpers/db.ts";

Deno.test("createLoggingTestDb records activities", () => {
  const { activities, db } = createLoggingTestDb();

  db.logActivity("system", "request.validation_failed", "bad.md", {
    file_path: "bad.md",
    errors: "invalid request",
  });

  assertEquals(activities.length, 1);
  assertEquals(activities[0].actor, "system");
  assertEquals(activities[0].actionType, "request.validation_failed");
  assertEquals(activities[0].target, "bad.md");
});
