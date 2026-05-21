/**
 * @module SafeErrorTest
 * @path packages/core/tests/errors/safe_error_test.ts
 * @description Verifies 'SafeError' logic, ensuring internal error details are
 * correctly redacted when serialized for external reporting.
 */

import { assertEquals, assertInstanceOf } from "@std/assert";
import { SafeError } from "@exaix/core/errors";
import type { EventLogger } from "@exaix/core/logger";
import type { JSONObject } from "@exaix/core/types";

// Mock EventLogger for testing
class MockEventLogger {
  public loggedErrors: Array<{
    action: string;
    target: string;
    payload?: JSONObject;
  }> = [];

  error(
    action: string,
    target: string,
    payload?: JSONObject,
  ): Promise<void> {
    this.loggedErrors.push({ action, target, payload: payload || {} });
    return Promise.resolve();
  }
}

Deno.test("SafeError: constructor sets properties correctly", () => {
  const error = new SafeError("User-friendly message", "INVALID_INPUT");

  assertEquals(error.message, "User-friendly message");
  assertEquals(error.errorCode, "INVALID_INPUT");
  assertEquals(error.name, "SafeError");
});

Deno.test("SafeError: constructor with internal error", () => {
  const internalError = new Error("Sensitive internal details");
  const error = new SafeError("User-friendly message", "FILE_NOT_FOUND", internalError);

  assertEquals(error.message, "User-friendly message");
  assertEquals(error.errorCode, "FILE_NOT_FOUND");
});

Deno.test("SafeError: toJSON excludes internal error details", () => {
  const internalError = new Error("Sensitive stack trace and details");
  internalError.stack = "Sensitive stack trace";
  const error = new SafeError("User message", "ERROR_CODE", internalError);

  const json = error.toJSON();

  assertEquals(json, {
    name: "SafeError",
    message: "User message",
    errorCode: "ERROR_CODE",
  });
});

Deno.test("SafeError: toString returns safe representation", () => {
  const error = new SafeError("Something went wrong", "GENERAL_ERROR");

  const string = error.toString();

  assertEquals(string, "SafeError: Something went wrong (code: GENERAL_ERROR)");
});

Deno.test("SafeError: logs internal error details when logger provided", () => {
  const mockLogger = new MockEventLogger();
  const internalError = new Error("Internal error details");
  internalError.stack = "Detailed stack trace";
  internalError.name = "TypeError";

  const _error = new SafeError(
    "User-friendly message",
    "VALIDATION_ERROR",
    internalError,
    mockLogger as Partial<EventLogger> as EventLogger,
  );

  assertEquals(mockLogger.loggedErrors.length, 1);
  const logged = mockLogger.loggedErrors[0];

  assertEquals(logged.action, "safe_error.internal_details");
  assertEquals(logged.target, "SafeError");
  assertEquals(logged.payload?.errorCode, "VALIDATION_ERROR");
  assertEquals(logged.payload?.userMessage, "User-friendly message");
  assertEquals(logged.payload?.internalMessage, "Internal error details");
  assertEquals(logged.payload?.internalStack, "Detailed stack trace");
  assertEquals(logged.payload?.internalName, "TypeError");
});

Deno.test("SafeError: does not log when no logger provided", () => {
  const internalError = new Error("Internal details");
  const error = new SafeError("User message", "ERROR_CODE", internalError);

  // No logger provided, so no logging should occur
  // This test mainly ensures no exceptions are thrown
  assertEquals(error.message, "User message");
});

Deno.test("SafeError: does not log when no internal error provided", () => {
  const mockLogger = new MockEventLogger();
  const _error = new SafeError(
    "User message",
    "ERROR_CODE",
    undefined,
    mockLogger as Partial<EventLogger> as EventLogger,
  );

  assertEquals(mockLogger.loggedErrors.length, 0);
});

Deno.test("SafeError: instanceof Error", () => {
  const error = new SafeError("Test message", "TEST_ERROR");

  assertInstanceOf(error, Error);
  assertInstanceOf(error, SafeError);
});

Deno.test("SafeError: preserves Error prototype chain", () => {
  const error = new SafeError("Test", "TEST");

  assertEquals(typeof error.stack, "string");
  assertEquals(error.name, "SafeError");
});
