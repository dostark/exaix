/**
 * @module ContextErrorTest
 * @path packages/core/tests/errors/context_error_test.ts
 * @description Verifies 'ContextError', ensuring stable capture of execution
 * metadata and preservation of underlying cause traces.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ContextError } from "@exaix/core/errors";

/**
 * ContextError - Enhanced error class with context preservation
 *
 * This class addresses section 20 of the security audit:
 * "Insufficient Error Context in Stack Traces"
 *
 * Provides structured error context and stack trace preservation
 * for better debugging and error handling throughout the application.
 */

Deno.test("ContextError: creates error with message and context", () => {
  const error = new ContextError("Test error message", {
    operation: "test_operation",
    user_id: "user123",
    request_id: "req456",
  });

  assertEquals(error.name, "ContextError");
  assertEquals(error.message, "Test error message");
  assertEquals(error.context, {
    operation: "test_operation",
    user_id: "user123",
    request_id: "req456",
  });
  assertEquals(error.cause, undefined);
});

Deno.test("ContextError: preserves cause error", () => {
  const cause = new Error("Original cause");
  const error = new ContextError("Wrapped error", { operation: "test" }, cause);

  assertEquals(error.message, "Wrapped error");
  assertEquals(error.cause, cause);
});

Deno.test("ContextError: preserves stack trace from cause", () => {
  const cause = new Error("Original error");
  cause.stack = "Error: Original error\n    at someFunction (file.ts:10:5)";

  const error = new ContextError("Wrapped error", { operation: "test" }, cause);

  // The stack should include the ContextError's stack plus the cause
  assertEquals(error.stack?.startsWith("ContextError: Wrapped error"), true);
  assertEquals(error.stack?.includes("Caused by: Error: Original error"), true);
  assertEquals(error.stack?.includes("at someFunction (file.ts:10:5)"), true);
});

Deno.test("ContextError: handles null/undefined cause gracefully", () => {
  const error = new ContextError("Test error", { operation: "test" }, undefined);

  assertEquals(error.cause, undefined);
  assertEquals(error.stack?.startsWith("ContextError: Test error"), true);
});

Deno.test("ContextError: toJSON includes all fields", () => {
  const cause = new Error("Cause error");
  cause.stack = "Error: Cause error\n    at function (file.ts:5:10)";

  const error = new ContextError("Main error", {
    operation: "test_op",
    user_id: "user123",
    timestamp: "2026-01-12T10:00:00Z",
  }, cause);

  const json = error.toJSON();

  assertEquals(json.name, "ContextError");
  assertEquals(json.message, "Main error");
  assertEquals(json.context, {
    operation: "test_op",
    user_id: "user123",
    timestamp: "2026-01-12T10:00:00Z",
  });
  assertEquals(json.cause, {
    name: "Error",
    message: "Cause error",
  });
  assertEquals(json.stack, error.stack);
});

Deno.test("ContextError: toJSON handles non-Error cause", () => {
  const error = new ContextError("Main error", { operation: "test" }, "string cause" as Partial<Error> as Error);

  const json = error.toJSON();

  assertEquals(json.cause, undefined);
});

Deno.test("ContextError: maintains instanceof Error", () => {
  const error = new ContextError("Test error", { operation: "test" });

  assertEquals(error instanceof Error, true);
  assertEquals(error instanceof ContextError, true);
});

Deno.test("ContextError: supports error chaining with throw", () => {
  const cause = new Error("Database connection failed");

  assertThrows(
    () => {
      try {
        throw cause;
      } catch (error) {
        // deno-lint-ignore no-unreachable
        throw new ContextError(
          "Failed to process user request",
          {
            operation: "process_request",
            user_id: "user123",
            request_id: "req456",
            timestamp: new Date().toISOString(),
          },
          error as Error,
        );
      }
    },
    ContextError,
    "Failed to process user request",
  );
});

Deno.test("ContextError: preserves original stack trace in chained errors", () => {
  const cause = new Error("File not found");
  cause.stack = "Error: File not found\n    at readFile (fs.ts:25:12)\n    at processFile (app.ts:45:8)";

  const contextError = new ContextError(
    "Processing failed",
    { file_path: "/tmp/test.txt", operation: "file_read" },
    cause,
  );

  assertEquals(contextError.stack?.includes("Caused by:"), true);
  assertEquals(contextError.stack?.includes("readFile (fs.ts:25:12)"), true);
  assertEquals(contextError.stack?.includes("processFile (app.ts:45:8)"), true);
});
