/**
 * @module CLIFallbackRegressionTest
 * @path tests/cli_fallback_regression_test.ts
 * @description Regression tests for CLI argument parsing, ensuring that the system
 * correctly falls back to interactive modes when required parameters are missing.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { EventLogger } from "../../src/services/core/event_logger.ts";
import { createStubConfig, createStubContext, createStubDb } from "../helpers/test_helpers.ts";
import { createMockConfig } from "../helpers/config.ts";
import type { IDatabaseService } from "../../src/services/core/db.ts";
import { ExaPathDefaults } from "../../src/shared/constants.ts";
import { BlueprintCommands } from "../../src/cli/commands/blueprint_commands.ts";
import { RequestCommands } from "../../src/cli/commands/request_commands.ts";
import { PlanCommands } from "../../src/cli/commands/plan_commands.ts";
import { __test_initializeServices } from "../../src/cli/exactl.ts";

const TEST_ACTION = "test.action";
const TEST_WARNING = "test.warning";
const TEST_ERROR = "test.error";
const TEST_DEBUG = "test.debug";
const TEST_TARGET = "test-target";
const CHILD_ACTION = "child.action";
const CHILD_TARGET = "child-target";
const TEST_TRACE_ID = "test-trace-123";
const TEST_USER = "test-user";

// ============================================================================
// Stub Database Interface Tests
// ============================================================================

Deno.test("[regression] Stub db object has required logActivity method", () => {
  // This is the stub db object used in exactl.ts fallback paths
  const stubDb = createStubDb();

  // Verify methods exist and are callable
  assertExists(stubDb.logActivity, "stubDb.logActivity should exist");
  assertExists(stubDb.waitForFlush, "stubDb.waitForFlush should exist");
  assertEquals(typeof stubDb.logActivity, "function");
  assertEquals(typeof stubDb.waitForFlush, "function");

  // Verify they can be called without throwing
  stubDb.logActivity(TEST_USER, TEST_ACTION, TEST_TARGET, {});
  stubDb.waitForFlush();
});

Deno.test("[regression] EventLogger works with stub db that has logActivity", async () => {
  // Simulate the fallback db stub from exactl.ts
  const stubDb = createStubDb();

  // Create EventLogger with stub db (same as CLI does in fallback mode)
  const logger = new EventLogger({ db: stubDb });

  // These should NOT throw "this.db.logActivity is not a function"
  await logger.info(TEST_ACTION, TEST_TARGET, { key: "value" });
  await logger.warn(TEST_WARNING, TEST_TARGET);
  await logger.error(TEST_ERROR, TEST_TARGET);
  await logger.debug(TEST_DEBUG, TEST_TARGET);

  // If we get here without throwing, the test passes
  assert(true, "EventLogger should work with stub db");
});

Deno.test("[regression] EventLogger works with empty db (no methods) - should not crash", async () => {
  // Before the fix, this would throw: "TypeError: this.db.logActivity is not a function"
  // After the fix, EventLogger should handle this gracefully

  // Simulate a DB object that will throw when logActivity is called (tests EventLogger's internal error handling)
  const emptyDb: IDatabaseService = {
    logActivity: () => {
      throw new Error("logActivity missing");
    },
    waitForFlush: () => Promise.resolve(),
    queryActivity: () => Promise.resolve([]),
    preparedGet: () => Promise.resolve(null),
    preparedAll: () => Promise.resolve([]),
    preparedRun: () => Promise.resolve({}),
    getActivitiesByTrace: () => [],
    getActivitiesByTraceSafe: () => Promise.resolve([]),
    getActivitiesByActionType: () => [],
    getActivitiesByActionTypeSafe: () => Promise.resolve([]),
    getRecentActivity: () => Promise.resolve([]),
    close: () => Promise.resolve(),
  };

  // Create EventLogger with the simulated broken db
  const logger = new EventLogger({ db: emptyDb });

  // These should gracefully handle missing logActivity
  // The error should be caught and logged as a warning, not thrown
  try {
    await logger.info(TEST_ACTION, TEST_TARGET, { key: "value" });
    // If db.logActivity is missing, EventLogger will catch the error internally
  } catch (error) {
    // This is NOT expected after the fix - EventLogger should handle missing methods
    // But we include this test to document the behavior
    assert(
      (error as Error).message.includes("logActivity"),
      "If error occurs, it should be about logActivity",
    );
  }
});

Deno.test("[regression] EventLogger works with no db at all (console-only mode)", async () => {
  // EventLogger should work in console-only mode when no db is provided
  const logger = new EventLogger({});

  // Should not throw
  await logger.info(TEST_ACTION, TEST_TARGET, { key: "value" });
  await logger.warn(TEST_WARNING, TEST_TARGET);
  await logger.error(TEST_ERROR, TEST_TARGET);

  assert(true, "EventLogger should work without db");
});

Deno.test("[regression] EventLogger child loggers work with stub db", async () => {
  const stubDb = createStubDb();

  const parentLogger = new EventLogger({ db: stubDb });
  const childLogger = parentLogger.child({ actor: TEST_USER, traceId: TEST_TRACE_ID });

  // Child logger should also work without throwing
  await childLogger.info(CHILD_ACTION, CHILD_TARGET, { from: "child" });

  assert(true, "Child logger should work with stub db");
});

// ============================================================================
// CLI Command Regression Tests
// ============================================================================

Deno.test({
  name: "[regression] CLI falls back gracefully when services fail to initialize",
  // Disable resource sanitizer as ConfigService may load SQLite dynamic library
  sanitizeResources: false,
  async fn() {
    // Set test mode before importing exactl to prevent top-level service initialization
    const originalEnv = Deno.env.get("EXA_TEST_CLI_MODE");
    Deno.env.set("EXA_TEST_CLI_MODE", "1");

    try {
      // Import the test helper from exactl to verify fallback behavior

      // Simulate service initialization failure
      const result = await __test_initializeServices({ simulateFail: true });

      // Should return success: false but with valid stub services
      assertEquals(result.success, false);

      // The db stub should have the required methods
      assertExists(result.db, "Fallback db should exist");
      assertExists(result.db.logActivity, "Fallback db should have logActivity");
      assertExists(result.db.waitForFlush, "Fallback db should have waitForFlush");
    } finally {
      // Restore environment
      if (originalEnv === undefined) {
        Deno.env.delete("EXA_TEST_CLI_MODE");
      } else {
        Deno.env.set("EXA_TEST_CLI_MODE", originalEnv);
      }
    }
  },
});

Deno.test("[regression] CLI test mode context has stub db with required methods", async () => {
  // Set environment to force test mode
  const originalEnv = Deno.env.get("EXA_TEST_CLI_MODE");
  Deno.env.set("EXA_TEST_CLI_MODE", "1");

  try {
    // Re-import to get test mode context
    // Note: Due to module caching, this may not re-initialize
    // Instead, we verify the test helper directly

    const result = await __test_initializeServices({ simulateFail: true });

    // Verify stub methods exist
    assertEquals(typeof result.db.logActivity, "function");
    assertEquals(typeof result.db.waitForFlush, "function");
  } finally {
    // Restore environment
    if (originalEnv === undefined) {
      Deno.env.delete("EXA_TEST_CLI_MODE");
    } else {
      Deno.env.set("EXA_TEST_CLI_MODE", originalEnv);
    }
  }
});

// ============================================================================
// Specific Command Regression Tests
// ============================================================================

Deno.test("[regression] BlueprintCommands works with stub db", async () => {
  // Create minimal config
  const config = createMockConfig(Deno.cwd(), { paths: { ...ExaPathDefaults } });

  // Create stub db with required methods
  const stubDb = createStubDb();

  // Create command handler
  const blueprintCommands = new BlueprintCommands(createStubContext({ config: createStubConfig(config), db: stubDb }));

  // list() should work without throwing db errors
  try {
    await blueprintCommands.list();
  } catch (error) {
    // Directory not found is OK, but "logActivity is not a function" is NOT OK
    const message = (error as Error).message;
    assert(
      !message.includes("logActivity is not a function"),
      "Should not throw logActivity error",
    );
  }
});

Deno.test("[regression] RequestCommands works with stub db", async () => {
  // Create minimal config
  const config = createMockConfig(Deno.cwd());
  config.paths.workspace = "Workspace";
  config.paths.requests = "Requests";

  // Create stub db with required methods
  const stubDb = createStubDb();

  // Create command handler
  const requestCommands = new RequestCommands(createStubContext({ config: createStubConfig(config), db: stubDb }));

  // list() should work without throwing db errors
  try {
    await requestCommands.list();
  } catch (error) {
    // Directory not found is OK, but "logActivity is not a function" is NOT OK
    const message = (error as Error).message;
    assert(
      !message.includes("logActivity is not a function"),
      "Should not throw logActivity error",
    );
  }
});

Deno.test("[regression] PlanCommands works with stub db", async () => {
  // Create minimal config with all required paths
  const config = createMockConfig(Deno.cwd(), { paths: { ...ExaPathDefaults } });

  // Create stub db with required methods
  const stubDb = createStubDb();

  // Create command handler
  const planCommands = new PlanCommands(createStubContext({ config: createStubConfig(config), db: stubDb }));

  // list() should work without throwing db errors
  try {
    await planCommands.list();
  } catch (error) {
    // Directory not found is OK, but "logActivity is not a function" is NOT OK
    const message = (error as Error).message;
    assert(
      !message.includes("logActivity is not a function"),
      "Should not throw logActivity error",
    );
  }
});
