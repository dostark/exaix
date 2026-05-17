/**
 * @module ToolResultRemediationPolicyTest
 * @path tests/services/tool/tool_result_remediation_policy_test.ts
 * @description Tests for remediation policy lookup and non-retry remediation modes
 * (fail_closed, escalate_only, normalize_then_validate) implemented in
 * packages/schemas/src/tool_result_remediation.ts (Phase 78 Step 78.3).
 */

import { assertEquals, assertExists } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import { Severity, ToolSideEffectScope } from "@exaix/core";
import {
  applyRemediationPolicy,
  REMEDIATION_OUTCOME_ESCALATED,
  REMEDIATION_OUTCOME_FAIL_CLOSED,
  REMEDIATION_OUTCOME_NORMALIZATION_FAILED,
  REMEDIATION_OUTCOME_PASSED,
} from "@exaix/schemas/tool_result_remediation.ts";
import { lookupRemediationPolicy } from "@exaix/mcp";
import {
  type IToolResultRemediationPolicy,
  REMEDIATION_MODE_ESCALATE_ONLY,
  REMEDIATION_MODE_FAIL_CLOSED,
  REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
} from "@exaix/schemas/tool_result.ts";
import { validateToolResultEnvelope } from "@exaix/schemas/tool_result_validator.ts";
import type { IToolResultValidationFailure } from "@exaix/schemas/tool_result_validator.ts";

const KNOWN_MUTATING_TOOL = "write_file";
const KNOWN_READONLY_TOOL = "read_file";

const syntheticFailure: IToolResultValidationFailure = {
  tool: "run_command",
  stage: "registry_boundary",
  severity: Severity.ERROR,
  retryAllowed: false,
  sideEffectRisk: ToolSideEffectScope.NONE,
  issues: [{ path: ["success"], message: "Expected boolean, received string", code: "invalid_type" }],
  rawResult: { success: "yes" },
};

// ============================================================================
// lookupRemediationPolicy
// ============================================================================

Deno.test("tool_result_remediation_policy: lookupRemediationPolicy returns policy for known tool", () => {
  const policy = lookupRemediationPolicy(KNOWN_MUTATING_TOOL);
  assertExists(policy, "Expected policy for known mutating tool");
  assertEquals(policy.tool, KNOWN_MUTATING_TOOL);
  assertExists(policy.mode);
});

Deno.test("tool_result_remediation_policy: lookupRemediationPolicy returns null for unknown tool", () => {
  const policy = lookupRemediationPolicy("nonexistent_tool_xyz");
  assertEquals(policy, null);
});

Deno.test("tool_result_remediation_policy: mutating tool gets fail_closed mode", () => {
  const policy = lookupRemediationPolicy(KNOWN_MUTATING_TOOL);
  assertExists(policy);
  assertEquals(policy.mode, REMEDIATION_MODE_FAIL_CLOSED);
});

Deno.test("tool_result_remediation_policy: read-only tool gets normalize_then_validate mode", () => {
  const policy = lookupRemediationPolicy(KNOWN_READONLY_TOOL);
  assertExists(policy);
  assertEquals(policy.mode, REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE);
});

// ============================================================================
// applyRemediationPolicy — fail_closed
// ============================================================================

Deno.test("tool_result_remediation_policy: fail_closed mode returns fail_closed outcome immediately", async () => {
  const policy: IToolResultRemediationPolicy = {
    tool: "run_command",
    mode: REMEDIATION_MODE_FAIL_CLOSED,
    maxRetries: 0,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
  };
  const result = await applyRemediationPolicy(
    "run_command",
    policy,
    syntheticFailure,
    { validateEnvelope: validateToolResultEnvelope, validateMCPResponse: () => null },
  );
  assertEquals(result.outcome, REMEDIATION_OUTCOME_FAIL_CLOSED);
  assertExists(result.failure);
  assertEquals(result.retriesAttempted, 0);
});

// ============================================================================
// applyRemediationPolicy — escalate_only
// ============================================================================

Deno.test("tool_result_remediation_policy: escalate_only mode returns escalated outcome", async () => {
  const policy: IToolResultRemediationPolicy = {
    tool: "run_command",
    mode: REMEDIATION_MODE_ESCALATE_ONLY,
    maxRetries: 0,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
  };
  const result = await applyRemediationPolicy(
    "run_command",
    policy,
    syntheticFailure,
    { validateEnvelope: validateToolResultEnvelope, validateMCPResponse: () => null },
  );
  assertEquals(result.outcome, REMEDIATION_OUTCOME_ESCALATED);
  assertExists(result.failure);
  assertEquals(result.retriesAttempted, 0);
});

// ============================================================================
// applyRemediationPolicy — normalize_then_validate
// ============================================================================

Deno.test("tool_result_remediation_policy: normalize_then_validate without normalize fn returns normalization_failed", async () => {
  const policy: IToolResultRemediationPolicy = {
    tool: "read_file",
    mode: REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
    maxRetries: 0,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
  };
  const result = await applyRemediationPolicy(
    "read_file",
    policy,
    syntheticFailure,
    { validateEnvelope: validateToolResultEnvelope, validateMCPResponse: () => null },
  );
  assertEquals(result.outcome, REMEDIATION_OUTCOME_NORMALIZATION_FAILED);
  assertEquals(result.retriesAttempted, 0);
});

Deno.test("tool_result_remediation_policy: normalize_then_validate with fix-producing normalize returns passed", async () => {
  const policy: IToolResultRemediationPolicy = {
    tool: "read_file",
    mode: REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
    maxRetries: 0,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
  };
  const result = await applyRemediationPolicy(
    "read_file",
    policy,
    syntheticFailure,
    { validateEnvelope: validateToolResultEnvelope, validateMCPResponse: () => null },
    {
      normalize: (_raw: JSONValue) => ({ success: true, data: "normalized" }),
    },
  );
  assertEquals(result.outcome, REMEDIATION_OUTCOME_PASSED);
  assertEquals(result.failure, null);
  assertEquals(result.retriesAttempted, 0);
});

Deno.test("tool_result_remediation_policy: normalize_then_validate with still-broken normalize returns normalization_failed", async () => {
  const policy: IToolResultRemediationPolicy = {
    tool: "read_file",
    mode: REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
    maxRetries: 0,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
  };
  const result = await applyRemediationPolicy(
    "read_file",
    policy,
    syntheticFailure,
    { validateEnvelope: validateToolResultEnvelope, validateMCPResponse: () => null },
    {
      normalize: (_raw: JSONValue) => ({ success: "still wrong" }),
    },
  );
  assertEquals(result.outcome, REMEDIATION_OUTCOME_NORMALIZATION_FAILED);
  assertExists(result.failure);
  assertEquals(result.retriesAttempted, 0);
});
