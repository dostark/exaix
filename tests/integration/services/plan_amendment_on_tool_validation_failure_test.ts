/**
 * @module PlanAmendmentOnToolValidationFailureTest
 * @path tests/integration/services/plan_amendment_on_tool_validation_failure_test.ts
 * @description Integration tests verifying plan amendment is triggered when
 * triggerPlanAmendmentOnFailure=true and the remediation outcome is terminal.
 * Tests the integration between logValidationResult and IPlanAmendmentService.
 * (Phase 78 Step 78.4)
 */

import { assertEquals, assertExists } from "@std/assert";
import type { IEventLogger } from "@exaix/core/logger/event_logger.ts";
import type { ILogEvent } from "@exaix/core";
import type { IPlanAmendmentService } from "@exaix/core/types";
import type { IPlanAmendmentTrigger } from "@exaix/schemas/plan_amendment.ts";
import {
  type IValidationReportContext,
  logValidationResult,
} from "../../../src/services/tool/tool_validation_reporter.ts";
import {
  type IToolResultRemediationPolicy,
  REMEDIATION_MODE_FAIL_CLOSED,
  REMEDIATION_MODE_RETRY_WITH_BACKOFF,
} from "@exaix/schemas/tool_result.ts";
import type { IRemediationResult } from "@exaix/schemas/tool_result_remediation.ts";
import {
  REMEDIATION_OUTCOME_FAIL_CLOSED,
  REMEDIATION_OUTCOME_PASSED,
  REMEDIATION_OUTCOME_RETRY_EXHAUSTED,
} from "@exaix/schemas/tool_result_remediation.ts";
import type { IToolResultValidationFailure } from "@exaix/schemas/tool_result.ts";

function createNoopLogger(): IEventLogger {
  const impl: IEventLogger = {
    log: () => Promise.resolve(),
    info: () => Promise.resolve(),
    warn: () => Promise.resolve(),
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    child: (_overrides: Partial<ILogEvent>): IEventLogger => impl,
  };
  return impl;
}

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

const failure: IToolResultValidationFailure = {
  tool: "write_file",
  issues: [{ path: ["success"], message: "Expected boolean", code: "invalid_type" }],
  rawResult: { success: "bad" },
};

function makePolicy(
  mode: IToolResultRemediationPolicy["mode"],
  triggerAmend: boolean,
): IToolResultRemediationPolicy {
  return {
    tool: "write_file",
    mode,
    maxRetries: 2,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: triggerAmend,
  };
}

Deno.test("plan_amendment_on_tool_validation_failure: fail_closed with triggerPlanAmendmentOnFailure=true calls shouldAmend with tool_error source", async () => {
  const mock = createMockAmendmentService();
  const ctx: IValidationReportContext = { planId: "plan-1", stepId: "step-42", amendments: mock.service };
  const result: IRemediationResult = { outcome: REMEDIATION_OUTCOME_FAIL_CLOSED, failure, retriesAttempted: 0 };
  await logValidationResult(
    "write_file",
    makePolicy(REMEDIATION_MODE_FAIL_CLOSED, true),
    result,
    createNoopLogger(),
    ctx,
  );
  assertExists(
    mock.triggeredWith,
    "shouldAmend must be called for terminal outcomes when triggerPlanAmendmentOnFailure=true",
  );
  assertEquals(mock.triggeredWith!.source, "tool_error");
  assertEquals(mock.triggeredWith!.toolName, "write_file");
  assertEquals(mock.triggeredWith!.stepId, "step-42");
});

Deno.test("plan_amendment_on_tool_validation_failure: retry_exhausted with triggerPlanAmendmentOnFailure=true calls shouldAmend", async () => {
  const mock = createMockAmendmentService();
  const ctx: IValidationReportContext = { planId: "plan-1", stepId: "step-7", amendments: mock.service };
  const result: IRemediationResult = { outcome: REMEDIATION_OUTCOME_RETRY_EXHAUSTED, failure, retriesAttempted: 2 };
  await logValidationResult(
    "write_file",
    makePolicy(REMEDIATION_MODE_RETRY_WITH_BACKOFF, true),
    result,
    createNoopLogger(),
    ctx,
  );
  assertExists(mock.triggeredWith);
  assertEquals(mock.triggeredWith!.source, "tool_error");
});

Deno.test("plan_amendment_on_tool_validation_failure: triggerPlanAmendmentOnFailure=false never calls shouldAmend", async () => {
  const mock = createMockAmendmentService();
  const ctx: IValidationReportContext = { planId: "plan-1", stepId: "step-1", amendments: mock.service };
  const result: IRemediationResult = { outcome: REMEDIATION_OUTCOME_FAIL_CLOSED, failure, retriesAttempted: 0 };
  await logValidationResult(
    "write_file",
    makePolicy(REMEDIATION_MODE_FAIL_CLOSED, false),
    result,
    createNoopLogger(),
    ctx,
  );
  assertEquals(mock.triggeredWith, null, "shouldAmend must NOT be called when triggerPlanAmendmentOnFailure=false");
});

Deno.test("plan_amendment_on_tool_validation_failure: passed outcome with triggerPlanAmendmentOnFailure=true does not call shouldAmend", async () => {
  const mock = createMockAmendmentService();
  const ctx: IValidationReportContext = { planId: "plan-1", stepId: "step-1", amendments: mock.service };
  const result: IRemediationResult = { outcome: REMEDIATION_OUTCOME_PASSED, failure: null, retriesAttempted: 1 };
  await logValidationResult(
    "write_file",
    makePolicy(REMEDIATION_MODE_RETRY_WITH_BACKOFF, true),
    result,
    createNoopLogger(),
    ctx,
  );
  assertEquals(mock.triggeredWith, null, "shouldAmend must NOT be called for passed outcomes");
});
