/**
 * @module ToolResultValidatorTest
 * @path tests/services/tool/tool_result_validator_test.ts
 * @description Tests for stateless tool result validation functions exported from
 * packages/schemas/src/tool_result_validator.ts. Validates envelope and MCP response
 * validation at registry and adapter boundaries (Phase 78 Enforcement Points 1 and 2).
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  type IToolResultValidator,
  validateMCPToolResponse,
  validateToolResultEnvelope,
} from "@exaix/schemas/tool_result_validator.ts";

// ============================================================================
// validateToolResultEnvelope — envelope validation
// ============================================================================

Deno.test("tool_result_validator: valid success envelope passes", () => {
  const result = validateToolResultEnvelope("run_command", {
    success: true,
    data: { output: "output", exitCode: 0 },
  });
  assertEquals(result, null);
});

Deno.test("tool_result_validator: valid failure envelope passes", () => {
  const result = validateToolResultEnvelope("run_command", {
    success: false,
    error: "command not found",
  });
  assertEquals(result, null);
});

Deno.test("tool_result_validator: success-only envelope (no data) passes", () => {
  const result = validateToolResultEnvelope("search_files", {
    success: true,
  });
  assertEquals(result, null);
});

Deno.test("tool_result_validator: invalid run_command data shape produces failure", () => {
  const result = validateToolResultEnvelope("run_command", {
    success: true,
    data: { stdout: "output", stderr: "", exitCode: 0 },
  });
  assertExists(result);
  assertEquals(result.tool, "run_command");
  assertEquals(result.stage, "registry_boundary");
});

Deno.test("tool_result_validator: invalid search_files data shape produces failure", () => {
  const result = validateToolResultEnvelope("search_files", {
    success: true,
    data: ["a.ts", "b.ts"],
  });
  assertExists(result);
  assertEquals(result.tool, "search_files");
  assertEquals(result.stage, "registry_boundary");
});

Deno.test("tool_result_validator: missing success field produces failure", () => {
  const result = validateToolResultEnvelope("run_command", {
    data: { stdout: "", stderr: "", exitCode: 0 },
  });
  assertExists(result);
  assertEquals(result.tool, "run_command");
  assertEquals(result.issues.length > 0, true);
});

Deno.test("tool_result_validator: null result produces failure", () => {
  const result = validateToolResultEnvelope("run_command", null);
  assertExists(result);
  assertEquals(result.tool, "run_command");
  assertEquals(result.issues.length > 0, true);
});

Deno.test("tool_result_validator: non-boolean success produces failure", () => {
  const result = validateToolResultEnvelope("run_command", {
    success: "true",
    data: null,
  });
  assertExists(result);
  assertEquals(result.tool, "run_command");
});

Deno.test("tool_result_validator: rawResult captured in failure for audit", () => {
  const rawResult = { success: "yes", unexpected: "shape" };
  const result = validateToolResultEnvelope("run_command", rawResult);
  assertExists(result);
  assertExists(result.rawResult, "rawResult must be captured for audit logging");
});

Deno.test("tool_result_validator: failure issues do not embed raw payload values", () => {
  const rawResult = { success: "yes", unexpected: "shape" };
  const result = validateToolResultEnvelope("run_command", rawResult);
  assertExists(result);
  for (const issue of result.issues) {
    assertEquals(
      issue.message.includes("shape"),
      false,
      "Issue message must not embed raw payload string values",
    );
  }
});

// ============================================================================
// IToolResultValidator interface conformance
// ============================================================================

Deno.test("tool_result_validator: IToolResultValidator interface is exported and callable", () => {
  const validator: IToolResultValidator = {
    validateEnvelope: validateToolResultEnvelope,
    validateMCPResponse: validateMCPToolResponse,
  };
  assertExists(validator);
  const result = validator.validateEnvelope("run_command", { success: true });
  assertEquals(result, null);
});
