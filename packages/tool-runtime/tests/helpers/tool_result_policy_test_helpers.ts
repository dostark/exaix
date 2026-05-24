/**
 * @module ToolResultPolicyTestHelpers
 * @path tests/services/tool/helpers/tool_result_policy_test_helpers.ts
 * @description Shared fixtures for tool result remediation and retry policy tests.
 */

import { type JSONValue, Severity, ToolSideEffectScope } from "@exaix/core";
import type { IToolResultRemediationPolicy } from "@exaix/schemas/tool_result.ts";
import type { IToolResultValidationFailure } from "@exaix/schemas/tool_result_validator.ts";
import { validateToolResultEnvelope } from "@exaix/schemas/tool_result_validator.ts";

export const SYNTHETIC_FAILURE: IToolResultValidationFailure = {
  tool: "run_command",
  stage: "registry_boundary",
  severity: Severity.ERROR,
  retryAllowed: true,
  sideEffectRisk: ToolSideEffectScope.NONE,
  issues: [{ path: ["success"], message: "Expected boolean, received string", code: "invalid_type" }],
  rawResult: { success: "yes" },
};

export const VALIDATION_ADAPTER = {
  validateEnvelope: validateToolResultEnvelope,
  validateMCPResponse: () => null,
};

export function createRemediationPolicy(
  tool: string,
  mode: IToolResultRemediationPolicy["mode"],
  overrides: Partial<IToolResultRemediationPolicy> = {},
): IToolResultRemediationPolicy {
  return {
    tool,
    mode,
    maxRetries: 0,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
    ...overrides,
  };
}

export function createValidationFailure(
  overrides: Partial<IToolResultValidationFailure> = {},
): IToolResultValidationFailure {
  return {
    ...SYNTHETIC_FAILURE,
    ...overrides,
  };
}

export function createToolMetadata(
  overrides: Partial<{ idempotent: boolean; sideEffectScope: ToolSideEffectScope }> = {},
): { idempotent: boolean; sideEffectScope: ToolSideEffectScope } {
  return {
    idempotent: true,
    sideEffectScope: ToolSideEffectScope.NONE,
    ...overrides,
  };
}

export function createRetryValidator(
  onFirstFailure: (toolName: string, rawResult: JSONValue) => IToolResultValidationFailure,
  onValidation?: () => void,
): {
  validateEnvelope: (toolName: string, rawResult: JSONValue) => IToolResultValidationFailure | null;
  validateMCPResponse: () => null;
} {
  let validationCalls = 0;

  return {
    validateEnvelope: (toolName: string, rawResult: JSONValue): IToolResultValidationFailure | null => {
      onValidation?.();
      validationCalls += 1;
      if (validationCalls === 1) {
        return onFirstFailure(toolName, rawResult);
      }
      return validateToolResultEnvelope(toolName, rawResult as Parameters<typeof validateToolResultEnvelope>[1]);
    },
    validateMCPResponse: () => null,
  };
}
