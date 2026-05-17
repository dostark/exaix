/**
 * @module ToolResultPolicySchemaTest
 * @path packages/schemas/tests/tool_result_policy_schema_test.ts
 * @description Verifies ToolResultRemediationPolicySchema enforces policy modes,
 * default values, and retry bounds using the TOOL_RESULT_VALIDATION_MAX_RETRIES constant.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { TOOL_RESULT_VALIDATION_MAX_RETRIES } from "@exaix/core";
import { ZodError } from "zod";
import { ToolResultRemediationPolicySchema } from "@exaix/schemas/tool_result.ts";

// ============================================================================
// Policy modes
// ============================================================================

Deno.test("ToolResultRemediationPolicySchema: accepts fail_closed mode", () => {
  const policy = ToolResultRemediationPolicySchema.parse({
    tool: "write_file",
    mode: "fail_closed",
  });
  assertEquals(policy.mode, "fail_closed");
  assertEquals(policy.maxRetries, 0);
  assertEquals(policy.requiresIdempotency, true);
  assertEquals(policy.allowRetryAfterSideEffect, false);
  assertEquals(policy.logValidationFailures, true);
  assertEquals(policy.triggerPlanAmendmentOnFailure, false);
});

Deno.test("ToolResultRemediationPolicySchema: accepts normalize_then_validate mode", () => {
  const policy = ToolResultRemediationPolicySchema.parse({
    tool: "read_file",
    mode: "normalize_then_validate",
  });
  assertEquals(policy.mode, "normalize_then_validate");
});

Deno.test("ToolResultRemediationPolicySchema: accepts retry_once mode", () => {
  const policy = ToolResultRemediationPolicySchema.parse({
    tool: "git_status",
    mode: "retry_once",
    maxRetries: 1,
  });
  assertEquals(policy.mode, "retry_once");
  assertEquals(policy.maxRetries, 1);
});

Deno.test("ToolResultRemediationPolicySchema: accepts retry_with_backoff mode", () => {
  const policy = ToolResultRemediationPolicySchema.parse({
    tool: "search_files",
    mode: "retry_with_backoff",
    maxRetries: 2,
    requiresIdempotency: true,
  });
  assertEquals(policy.mode, "retry_with_backoff");
  assertEquals(policy.maxRetries, 2);
});

Deno.test("ToolResultRemediationPolicySchema: accepts escalate_only mode", () => {
  const policy = ToolResultRemediationPolicySchema.parse({
    tool: "git_commit",
    mode: "escalate_only",
    triggerPlanAmendmentOnFailure: true,
  });
  assertEquals(policy.mode, "escalate_only");
  assertEquals(policy.triggerPlanAmendmentOnFailure, true);
});

// ============================================================================
// maxRetries boundaries
// ============================================================================

Deno.test("ToolResultRemediationPolicySchema: maxRetries upper bound uses TOOL_RESULT_VALIDATION_MAX_RETRIES", () => {
  const policy = ToolResultRemediationPolicySchema.parse({
    tool: "read_file",
    mode: "retry_with_backoff",
    maxRetries: TOOL_RESULT_VALIDATION_MAX_RETRIES,
  });
  assertEquals(policy.maxRetries, TOOL_RESULT_VALIDATION_MAX_RETRIES);
});

Deno.test("ToolResultRemediationPolicySchema: rejects maxRetries above constant", () => {
  assertThrows(
    () =>
      ToolResultRemediationPolicySchema.parse({
        tool: "read_file",
        mode: "retry_with_backoff",
        maxRetries: TOOL_RESULT_VALIDATION_MAX_RETRIES + 1,
      }),
    ZodError,
  );
});

Deno.test("ToolResultRemediationPolicySchema: rejects negative maxRetries", () => {
  assertThrows(
    () =>
      ToolResultRemediationPolicySchema.parse({
        tool: "read_file",
        mode: "retry_once",
        maxRetries: -1,
      }),
    ZodError,
  );
});

// ============================================================================
// Validation errors
// ============================================================================

Deno.test("ToolResultRemediationPolicySchema: rejects unknown mode", () => {
  assertThrows(
    () =>
      ToolResultRemediationPolicySchema.parse({
        tool: "read_file",
        mode: "retry_forever",
      }),
    ZodError,
  );
});

Deno.test("ToolResultRemediationPolicySchema: rejects missing tool", () => {
  assertThrows(
    () => ToolResultRemediationPolicySchema.parse({ mode: "fail_closed" }),
    ZodError,
  );
});

Deno.test("ToolResultRemediationPolicySchema: rejects missing mode", () => {
  assertThrows(
    () => ToolResultRemediationPolicySchema.parse({ tool: "read_file" }),
    ZodError,
  );
});
