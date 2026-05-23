/**
 * @module ToolResultSchemaTest
 * @path packages/schemas/tests/tool_result_schema_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Verifies ToolResultEnvelopeSchema and ToolResultValidationFailureSchema
 * correctly validate IToolResult envelopes and structured validation failures.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { Severity, ToolErrorCode, ToolSideEffectScope } from "@exaix/core";
import { ZodError } from "zod";
import { ToolResultEnvelopeSchema, ToolResultValidationFailureSchema } from "@exaix/schemas";

// ============================================================================
// ToolResultEnvelopeSchema
// ============================================================================

Deno.test("ToolResultEnvelopeSchema: accepts valid success result", () => {
  const result = ToolResultEnvelopeSchema.parse({
    success: true,
    data: { count: 42, items: ["a", "b"] },
    meta: {
      tool: "search_files",
      resultType: "file_list",
      schemaVersion: "1.0.0",
      retryable: true,
    },
  });
  assertEquals(result.success, true);
  assertEquals(result.data, { count: 42, items: ["a", "b"] });
  assertEquals(result.meta, {
    tool: "search_files",
    resultType: "file_list",
    schemaVersion: "1.0.0",
    retryable: true,
  });
});

Deno.test("ToolResultEnvelopeSchema: accepts valid error result", () => {
  const result = ToolResultEnvelopeSchema.parse({
    success: false,
    error: "File not found",
    meta: {
      tool: "read_file",
      resultType: "tool_error",
      schemaVersion: "1.0.0",
    },
  });
  assertEquals(result.success, false);
  assertEquals(result.error, "File not found");
});

Deno.test("ToolResultEnvelopeSchema: accepts result with no optional fields", () => {
  const result = ToolResultEnvelopeSchema.parse({ success: true });
  assertEquals(result.success, true);
  assertEquals(result.data, undefined);
  assertEquals(result.error, undefined);
  assertEquals(result.meta, undefined);
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

Deno.test("ToolResultEnvelopeSchema: rejects success result that also carries error", () => {
  assertThrows(
    () =>
      ToolResultEnvelopeSchema.parse({
        success: true,
        error: "should not exist on success",
      }),
    ZodError,
  );
});

Deno.test("ToolResultEnvelopeSchema: rejects failed result without error", () => {
  assertThrows(
    () =>
      ToolResultEnvelopeSchema.parse({
        success: false,
        data: { count: 1 },
      }),
    ZodError,
  );
});

// ============================================================================
// ToolResultValidationFailureSchema
// ============================================================================

Deno.test("ToolResultValidationFailureSchema: accepts valid failure with issues", () => {
  const failure = ToolResultValidationFailureSchema.parse({
    tool: "read_file",
    stage: "registry_boundary",
    severity: Severity.ERROR,
    retryAllowed: false,
    sideEffectRisk: ToolSideEffectScope.PORTAL,
    issues: [
      { path: ["data", "content"], message: "Expected string", code: "invalid_type" },
    ],
  });
  assertEquals(failure.tool, "read_file");
  assertEquals(failure.stage, "registry_boundary");
  assertEquals(failure.severity, Severity.ERROR);
  assertEquals(failure.retryAllowed, false);
  assertEquals(failure.sideEffectRisk, ToolSideEffectScope.PORTAL);
  assertEquals(failure.issues.length, 1);
  assertEquals(failure.issues[0].path, ["data", "content"]);
});

Deno.test("ToolResultValidationFailureSchema: accepts optional toolErrorCode", () => {
  const failure = ToolResultValidationFailureSchema.parse({
    tool: "run_command",
    stage: "mcp_boundary",
    severity: Severity.WARN,
    retryAllowed: true,
    sideEffectRisk: ToolSideEffectScope.NONE,
    toolErrorCode: ToolErrorCode.EXECUTION_FAILED,
    issues: [{ path: [], message: "Missing exitCode", code: "invalid_type" }],
  });
  assertEquals(failure.toolErrorCode, ToolErrorCode.EXECUTION_FAILED);
});

Deno.test("ToolResultValidationFailureSchema: accepts rawResult for audit logging", () => {
  const failure = ToolResultValidationFailureSchema.parse({
    tool: "run_command",
    stage: "executor_boundary",
    severity: Severity.ERROR,
    retryAllowed: false,
    sideEffectRisk: ToolSideEffectScope.SYSTEM,
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
    () =>
      ToolResultValidationFailureSchema.parse({
        tool: "read_file",
        stage: "registry_boundary",
        severity: Severity.ERROR,
        retryAllowed: false,
        sideEffectRisk: ToolSideEffectScope.NONE,
      }),
    ZodError,
  );
});

Deno.test("ToolResultValidationFailureSchema: rejects invalid toolErrorCode", () => {
  assertThrows(
    () =>
      ToolResultValidationFailureSchema.parse({
        tool: "read_file",
        stage: "registry_boundary",
        severity: Severity.ERROR,
        retryAllowed: false,
        sideEffectRisk: ToolSideEffectScope.NONE,
        toolErrorCode: "UNKNOWN_CODE",
        issues: [],
      }),
    ZodError,
  );
});

Deno.test("ToolResultValidationFailureSchema: rejects missing remediation metadata", () => {
  assertThrows(
    () =>
      ToolResultValidationFailureSchema.parse({
        tool: "read_file",
        issues: [{ path: [], message: "err", code: "invalid_type" }],
      }),
    ZodError,
  );
});
