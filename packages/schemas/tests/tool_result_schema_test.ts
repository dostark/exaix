/**
 * @module ToolResultSchemaTest
 * @path packages/schemas/tests/tool_result_schema_test.ts
 * @description Verifies ToolResultEnvelopeSchema and ToolResultValidationFailureSchema
 * correctly validate IToolResult envelopes and structured validation failures.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ToolErrorCode } from "@exaix/core";
import { ZodError } from "zod";
import { ToolResultEnvelopeSchema, ToolResultValidationFailureSchema } from "@exaix/schemas/tool_result.ts";

// ============================================================================
// ToolResultEnvelopeSchema
// ============================================================================

Deno.test("ToolResultEnvelopeSchema: accepts valid success result", () => {
  const result = ToolResultEnvelopeSchema.parse({
    success: true,
    data: { count: 42, items: ["a", "b"] },
  });
  assertEquals(result.success, true);
  assertEquals(result.data, { count: 42, items: ["a", "b"] });
});

Deno.test("ToolResultEnvelopeSchema: accepts valid error result", () => {
  const result = ToolResultEnvelopeSchema.parse({
    success: false,
    error: "File not found",
  });
  assertEquals(result.success, false);
  assertEquals(result.error, "File not found");
});

Deno.test("ToolResultEnvelopeSchema: accepts result with no optional fields", () => {
  const result = ToolResultEnvelopeSchema.parse({ success: true });
  assertEquals(result.success, true);
  assertEquals(result.data, undefined);
  assertEquals(result.error, undefined);
});

Deno.test("ToolResultEnvelopeSchema: rejects missing success field", () => {
  assertThrows(
    () => ToolResultEnvelopeSchema.parse({ data: "hello" }),
    ZodError,
  );
});

Deno.test("ToolResultEnvelopeSchema: rejects non-boolean success", () => {
  assertThrows(
    () => ToolResultEnvelopeSchema.parse({ success: "yes" }),
    ZodError,
  );
});

Deno.test("ToolResultEnvelopeSchema: accepts null data (JSON null is valid JSONValue)", () => {
  const result = ToolResultEnvelopeSchema.parse({ success: true, data: null });
  assertEquals(result.success, true);
  assertEquals(result.data, null);
});

// ============================================================================
// ToolResultValidationFailureSchema
// ============================================================================

Deno.test("ToolResultValidationFailureSchema: accepts valid failure with issues", () => {
  const failure = ToolResultValidationFailureSchema.parse({
    tool: "read_file",
    issues: [
      { path: ["data", "content"], message: "Expected string", code: "invalid_type" },
    ],
  });
  assertEquals(failure.tool, "read_file");
  assertEquals(failure.issues.length, 1);
  assertEquals(failure.issues[0].path, ["data", "content"]);
});

Deno.test("ToolResultValidationFailureSchema: accepts optional toolErrorCode", () => {
  const failure = ToolResultValidationFailureSchema.parse({
    tool: "run_command",
    toolErrorCode: ToolErrorCode.EXECUTION_FAILED,
    issues: [{ path: [], message: "Missing exitCode", code: "invalid_type" }],
  });
  assertEquals(failure.toolErrorCode, ToolErrorCode.EXECUTION_FAILED);
});

Deno.test("ToolResultValidationFailureSchema: accepts rawResult for audit logging", () => {
  const failure = ToolResultValidationFailureSchema.parse({
    tool: "run_command",
    issues: [{ path: ["exitCode"], message: "Expected number", code: "invalid_type" }],
    rawResult: { stdout: "ok", exitCode: "zero" },
  });
  assertEquals(failure.rawResult, { stdout: "ok", exitCode: "zero" });
});

Deno.test("ToolResultValidationFailureSchema: rejects missing tool name", () => {
  assertThrows(
    () =>
      ToolResultValidationFailureSchema.parse({
        issues: [{ path: [], message: "err", code: "invalid_type" }],
      }),
    ZodError,
  );
});

Deno.test("ToolResultValidationFailureSchema: rejects missing issues array", () => {
  assertThrows(
    () => ToolResultValidationFailureSchema.parse({ tool: "read_file" }),
    ZodError,
  );
});

Deno.test("ToolResultValidationFailureSchema: rejects invalid toolErrorCode", () => {
  assertThrows(
    () =>
      ToolResultValidationFailureSchema.parse({
        tool: "read_file",
        toolErrorCode: "UNKNOWN_CODE",
        issues: [],
      }),
    ZodError,
  );
});
