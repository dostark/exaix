/**
 * @module PlanAmendmentOnToolValidationFailureTest
 * @path tests/integration/services/plan_amendment_on_tool_validation_failure_test.ts
 * @description Integration tests verifying plan amendment is triggered when
 * triggerPlanAmendmentOnFailure=true and the remediation outcome is terminal.
 * Tests the integration between live validation-reporting callers and IPlanAmendmentService.
 * (Phase 78 Step 78.4)
 */

import { assertEquals } from "@std/assert";
import { Severity, ToolSideEffectScope } from "@exaix/core";
import type { IPlanAmendmentService } from "@exaix/core/types";
import type { IPlanAmendmentTrigger } from "@exaix/schemas/plan_amendment.ts";
import type { IToolResultValidator } from "@exaix/schemas/tool_result_validator.ts";
import { validateToolResultEnvelope } from "@exaix/schemas/tool_result_validator.ts";
import type { IToolResultRemediationPolicy, IToolResultValidationFailure } from "@exaix/schemas/tool_result.ts";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "../../helpers/config.ts";

interface IMockAmendmentService {
  service: IPlanAmendmentService;
  triggeredWith: IPlanAmendmentTrigger | null;
}

function createMockAmendmentService(): IMockAmendmentService {
  let triggeredWith: IPlanAmendmentTrigger | null = null;
  const service: IPlanAmendmentService = {
    shouldAmend: (trigger) => {
      triggeredWith = trigger;
      return Promise.resolve(false);
    },
    proposeAmendment: (_input) =>
      Promise.resolve({
        amendmentId: crypto.randomUUID(),
        planId: "plan-1",
        affectedRemainingStepIds: ["step-1"],
        summary: "test",
        adds: [],
        updates: [],
        removes: [],
        createdAt: new Date().toISOString(),
      }),
    applyApprovedAmendment: (content, _patch) => content,
  };
  return {
    service,
    get triggeredWith() {
      return triggeredWith;
    },
  };
}

Deno.test("plan_amendment_on_tool_validation_failure: live fail_closed outcome can trigger shouldAmend", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "registry-amendment-fail-closed-" });
  const mock = createMockAmendmentService();

  try {
    const config = createMockConfig(tempDir);
    const validator: IToolResultValidator = {
      validateEnvelope: (toolName, rawResult) => ({
        tool: toolName,
        stage: "registry_boundary",
        severity: Severity.ERROR,
        retryAllowed: false,
        sideEffectRisk: ToolSideEffectScope.PORTAL,
        issues: [{ path: ["data"], message: "synthetic validation failure", code: "custom" }],
        rawResult: rawResult as IToolResultValidationFailure["rawResult"],
      }),
      validateMCPResponse: () => null,
    };
    const registry = new ToolRegistry({
      config,
      resultValidator: validator,
      validationReportContext: { planId: "plan-1", stepId: "step-42", amendments: mock.service },
      remediationPolicyResolver: (_toolName: string, policy: IToolResultRemediationPolicy) => ({
        ...policy,
        triggerPlanAmendmentOnFailure: true,
      }),
    });

    await registry.execute("write_file", { path: "note.txt", content: "hello" });
    assertEquals(mock.triggeredWith?.source, "tool_error");
    assertEquals(mock.triggeredWith?.toolName, "write_file");
    assertEquals(mock.triggeredWith?.stepId, "step-42");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("plan_amendment_on_tool_validation_failure: live passed remediation outcome does not call shouldAmend", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "registry-amendment-passed-" });
  const mock = createMockAmendmentService();
  let validationCalls = 0;

  try {
    await Deno.writeTextFile(`${tempDir}/match.ts`, "export const value = 1;\n");

    const config = createMockConfig(tempDir);
    const validator: IToolResultValidator = {
      validateEnvelope: (toolName, rawResult) => {
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
        return validateToolResultEnvelope(toolName, rawResult);
      },
      validateMCPResponse: () => null,
    };
    const registry = new ToolRegistry({
      config,
      resultValidator: validator,
      validationReportContext: { planId: "plan-1", stepId: "step-7", amendments: mock.service },
      remediationPolicyResolver: (_toolName: string, policy: IToolResultRemediationPolicy) => ({
        ...policy,
        triggerPlanAmendmentOnFailure: true,
      }),
    });

    await registry.execute("search_files", { pattern: "*.ts", path: tempDir });
    assertEquals(mock.triggeredWith, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
