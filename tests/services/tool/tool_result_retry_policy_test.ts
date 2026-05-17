/**
 * @module ToolResultRetryPolicyTest
 * @path tests/services/tool/tool_result_retry_policy_test.ts
 * @description Tests for retry-mode remediation policies (retry_once, retry_with_backoff)
 * including idempotency and side-effect guards, implemented in
 * packages/schemas/src/tool_result_remediation.ts (Phase 78 Step 78.3).
 */

import { assertEquals, assertExists } from "@std/assert";
import { type JSONValue, Severity, ToolSideEffectScope } from "@exaix/core";
import {
  applyRemediationPolicy,
  REMEDIATION_OUTCOME_FAIL_CLOSED,
  REMEDIATION_OUTCOME_PASSED,
  REMEDIATION_OUTCOME_RETRY_EXHAUSTED,
} from "@exaix/schemas/tool_result_remediation.ts";
import {
  type IToolResultRemediationPolicy,
  REMEDIATION_MODE_RETRY_ONCE,
  REMEDIATION_MODE_RETRY_WITH_BACKOFF,
} from "@exaix/schemas/tool_result.ts";
import { validateToolResultEnvelope } from "@exaix/schemas/tool_result_validator.ts";
import type { IToolResultValidationFailure } from "@exaix/schemas/tool_result_validator.ts";
import { ToolRegistry } from "../../../src/services/tool/tool_registry.ts";
import { createMockConfig } from "../../helpers/config.ts";

const syntheticFailure: IToolResultValidationFailure = {
  tool: "search_files",
  stage: "registry_boundary",
  severity: Severity.ERROR,
  retryAllowed: true,
  sideEffectRisk: ToolSideEffectScope.NONE,
  issues: [{ path: ["success"], message: "Expected boolean", code: "invalid_type" }],
  rawResult: { success: "yes" },
};

// idempotent=true, side_effect_scope=NONE (read-only, safe to retry)
const SAFE_RETRY_TOOL = "search_files";
// idempotent=false, side_effect_scope=PORTAL (mutating, unsafe to retry)
const UNSAFE_RETRY_TOOL = "write_file";

// ============================================================================
// retry_once — successful retry
// ============================================================================

Deno.test("tool_result_retry_policy: retry_once with successful retry returns passed", async () => {
  const policy: IToolResultRemediationPolicy = {
    tool: SAFE_RETRY_TOOL,
    mode: REMEDIATION_MODE_RETRY_ONCE,
    maxRetries: 1,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
  };
  const result = await applyRemediationPolicy(
    SAFE_RETRY_TOOL,
    policy,
    syntheticFailure,
    { validateEnvelope: validateToolResultEnvelope, validateMCPResponse: () => null },
    {
      retry: () => Promise.resolve({ success: true, data: { files: ["file_a.ts", "file_b.ts"] } }),
      toolMetadata: { idempotent: true, sideEffectScope: ToolSideEffectScope.NONE },
    },
  );
  assertEquals(result.outcome, REMEDIATION_OUTCOME_PASSED);
  assertEquals(result.failure, null);
  assertEquals(result.retriesAttempted, 1);
});

Deno.test("tool_result_retry_policy: retry_once with still-failing retry returns retry_exhausted", async () => {
  const policy: IToolResultRemediationPolicy = {
    tool: SAFE_RETRY_TOOL,
    mode: REMEDIATION_MODE_RETRY_ONCE,
    maxRetries: 1,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
  };
  const result = await applyRemediationPolicy(
    SAFE_RETRY_TOOL,
    policy,
    syntheticFailure,
    { validateEnvelope: validateToolResultEnvelope, validateMCPResponse: () => null },
    {
      retry: () => Promise.resolve({ success: "still wrong" }),
      toolMetadata: { idempotent: true, sideEffectScope: ToolSideEffectScope.NONE },
    },
  );
  assertEquals(result.outcome, REMEDIATION_OUTCOME_RETRY_EXHAUSTED);
  assertExists(result.failure);
  assertEquals(result.retriesAttempted, 1);
});

Deno.test("tool_result_retry_policy: retry_once without retry callback returns fail_closed", async () => {
  const policy: IToolResultRemediationPolicy = {
    tool: SAFE_RETRY_TOOL,
    mode: REMEDIATION_MODE_RETRY_ONCE,
    maxRetries: 1,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
  };
  const result = await applyRemediationPolicy(
    SAFE_RETRY_TOOL,
    policy,
    syntheticFailure,
    { validateEnvelope: validateToolResultEnvelope, validateMCPResponse: () => null },
  );
  assertEquals(result.outcome, REMEDIATION_OUTCOME_FAIL_CLOSED);
  assertEquals(result.retriesAttempted, 0);
});

// ============================================================================
// retry_with_backoff — bounded retry
// ============================================================================

Deno.test("tool_result_retry_policy: retry_with_backoff retries up to maxRetries and returns passed on success", async () => {
  let callCount = 0;
  const policy: IToolResultRemediationPolicy = {
    tool: SAFE_RETRY_TOOL,
    mode: REMEDIATION_MODE_RETRY_WITH_BACKOFF,
    maxRetries: 3,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
  };
  const result = await applyRemediationPolicy(
    SAFE_RETRY_TOOL,
    policy,
    syntheticFailure,
    { validateEnvelope: validateToolResultEnvelope, validateMCPResponse: () => null },
    {
      retry: () => {
        callCount += 1;
        const payload = callCount >= 2 ? { success: true } : { success: "bad" };
        return Promise.resolve(payload);
      },
      toolMetadata: { idempotent: true, sideEffectScope: ToolSideEffectScope.NONE },
    },
  );
  assertEquals(result.outcome, REMEDIATION_OUTCOME_PASSED);
  assertEquals(result.failure, null);
  assertEquals(result.retriesAttempted, 2);
});

Deno.test("tool_result_retry_policy: retry_with_backoff returns retry_exhausted after maxRetries", async () => {
  const policy: IToolResultRemediationPolicy = {
    tool: SAFE_RETRY_TOOL,
    mode: REMEDIATION_MODE_RETRY_WITH_BACKOFF,
    maxRetries: 2,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
  };
  const result = await applyRemediationPolicy(
    SAFE_RETRY_TOOL,
    policy,
    syntheticFailure,
    { validateEnvelope: validateToolResultEnvelope, validateMCPResponse: () => null },
    {
      retry: () => Promise.resolve({ success: "always wrong" }),
      toolMetadata: { idempotent: true, sideEffectScope: ToolSideEffectScope.NONE },
    },
  );
  assertEquals(result.outcome, REMEDIATION_OUTCOME_RETRY_EXHAUSTED);
  assertExists(result.failure);
  assertEquals(result.retriesAttempted, 2);
});

// ============================================================================
// Idempotency and side-effect guards
// ============================================================================

Deno.test("tool_result_retry_policy: retry blocked for non-idempotent tool when requiresIdempotency=true", async () => {
  const policy: IToolResultRemediationPolicy = {
    tool: UNSAFE_RETRY_TOOL,
    mode: REMEDIATION_MODE_RETRY_ONCE,
    maxRetries: 1,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
  };
  const failure: IToolResultValidationFailure = { ...syntheticFailure, tool: UNSAFE_RETRY_TOOL };
  const result = await applyRemediationPolicy(
    UNSAFE_RETRY_TOOL,
    policy,
    failure,
    { validateEnvelope: validateToolResultEnvelope, validateMCPResponse: () => null },
    {
      retry: () => Promise.resolve({ success: true }),
      toolMetadata: { idempotent: false, sideEffectScope: ToolSideEffectScope.PORTAL },
    },
  );
  assertEquals(
    result.outcome,
    REMEDIATION_OUTCOME_FAIL_CLOSED,
    "Non-idempotent tool must not be retried when requiresIdempotency=true",
  );
  assertEquals(result.retriesAttempted, 0);
});

Deno.test("tool_result_retry_policy: retry blocked for side-effecting tool when allowRetryAfterSideEffect=false", async () => {
  const policy: IToolResultRemediationPolicy = {
    tool: UNSAFE_RETRY_TOOL,
    mode: REMEDIATION_MODE_RETRY_ONCE,
    maxRetries: 1,
    requiresIdempotency: false,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
  };
  const failure: IToolResultValidationFailure = { ...syntheticFailure, tool: UNSAFE_RETRY_TOOL };
  const result = await applyRemediationPolicy(
    UNSAFE_RETRY_TOOL,
    policy,
    failure,
    { validateEnvelope: validateToolResultEnvelope, validateMCPResponse: () => null },
    {
      retry: () => Promise.resolve({ success: true }),
      toolMetadata: { idempotent: true, sideEffectScope: ToolSideEffectScope.PORTAL },
    },
  );
  assertEquals(
    result.outcome,
    REMEDIATION_OUTCOME_FAIL_CLOSED,
    "Side-effecting tool must not be retried when allowRetryAfterSideEffect=false",
  );
  assertEquals(result.retriesAttempted, 0);
});

Deno.test("tool_result_retry_policy: registry boundary recovers read-only result via live remediation path", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "registry-remediation-readonly-" });
  let validationCalls = 0;

  try {
    await Deno.writeTextFile(`${tempDir}/match.ts`, "export const value = 1;\n");

    const config = createMockConfig(tempDir);
    const validator = {
      validateEnvelope: (toolName: string, rawResult: JSONValue): IToolResultValidationFailure | null => {
        validationCalls += 1;
        if (validationCalls === 1) {
          return {
            tool: toolName,
            stage: "registry_boundary",
            severity: Severity.ERROR,
            retryAllowed: true,
            sideEffectRisk: ToolSideEffectScope.NONE,
            issues: [{ path: ["data"], message: "synthetic validation failure", code: "custom" }],
            rawResult: rawResult as IToolResultValidationFailure["rawResult"],
          };
        }
        return validateToolResultEnvelope(toolName, rawResult as Parameters<typeof validateToolResultEnvelope>[1]);
      },
      validateMCPResponse: () => null,
    };

    const registry = new ToolRegistry({ config, resultValidator: validator });
    const result = await registry.execute("search_files", { pattern: "*.ts", path: tempDir });

    assertEquals(result.success, true);
    assertEquals(validationCalls, 2, "read-only remediation should revalidate after policy handling");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
