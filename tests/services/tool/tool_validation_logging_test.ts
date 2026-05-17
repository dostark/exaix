/**
 * @module ToolValidationLoggingTest
 * @path tests/services/tool/tool_validation_logging_test.ts
 * @description Unit tests for tool validation failure logging and plan amendment
 * integration in src/services/tool/tool_validation_reporter.ts (Phase 78 Step 78.4).
 */

import { assertEquals } from "@std/assert";
import type { IEventLogger } from "@exaix/core/logger/event_logger.ts";
import type { ILogEvent } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import {
  type IValidationReportContext,
  logValidationResult,
  TOOL_VALIDATION_EVENT_ESCALATED,
  TOOL_VALIDATION_EVENT_FAIL_CLOSED,
  TOOL_VALIDATION_EVENT_NORMALIZATION_FAILED,
  TOOL_VALIDATION_EVENT_NORMALIZATION_SUCCESS,
  TOOL_VALIDATION_EVENT_RETRY_EXHAUSTED,
  TOOL_VALIDATION_EVENT_RETRY_SUCCESS,
} from "../../../src/services/tool/tool_validation_reporter.ts";
import {
  type IToolResultRemediationPolicy,
  REMEDIATION_MODE_ESCALATE_ONLY,
  REMEDIATION_MODE_FAIL_CLOSED,
  REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
  REMEDIATION_MODE_RETRY_WITH_BACKOFF,
} from "@exaix/schemas/tool_result.ts";
import type { IRemediationResult } from "@exaix/schemas/tool_result_remediation.ts";
import {
  REMEDIATION_OUTCOME_ESCALATED,
  REMEDIATION_OUTCOME_FAIL_CLOSED,
  REMEDIATION_OUTCOME_NORMALIZATION_FAILED,
  REMEDIATION_OUTCOME_PASSED,
  REMEDIATION_OUTCOME_RETRY_EXHAUSTED,
} from "@exaix/schemas/tool_result_remediation.ts";
import type { IToolResultValidationFailure } from "@exaix/schemas/tool_result.ts";
import type { IPlanAmendmentService } from "@exaix/core/types";

// ============================================================================
// Mock helpers
// ============================================================================

interface ICapturedEvent {
  action: string;
  target: string;
  payload?: Record<string, JSONValue>;
}

function createMockLogger(): IEventLogger & { events: ICapturedEvent[] } {
  const events: ICapturedEvent[] = [];
  const impl: IEventLogger = {
    log(event: ILogEvent): Promise<void> {
      events.push({ action: event.action, target: event.target, payload: event.payload });
      return Promise.resolve();
    },
    info(action: string, target: string | null): Promise<void> {
      events.push({ action, target: target ?? "" });
      return Promise.resolve();
    },
    warn(action: string, target: string | null): Promise<void> {
      events.push({ action, target: target ?? "" });
      return Promise.resolve();
    },
    error(action: string, target: string | null): Promise<void> {
      events.push({ action, target: target ?? "" });
      return Promise.resolve();
    },
    fatal(action: string, target: string | null): Promise<void> {
      events.push({ action, target: target ?? "" });
      return Promise.resolve();
    },
    debug(action: string, target: string | null): Promise<void> {
      events.push({ action, target: target ?? "" });
      return Promise.resolve();
    },
    child(_overrides: Partial<ILogEvent>): IEventLogger {
      return impl;
    },
  };
  return Object.assign(impl, { events });
}

const syntheticFailure: IToolResultValidationFailure = {
  tool: "search_files",
  issues: [{ path: ["success"], message: "Expected boolean", code: "invalid_type" }],
  rawResult: { success: "bad" },
};

function makePolicy(
  mode: IToolResultRemediationPolicy["mode"],
  overrides?: Partial<IToolResultRemediationPolicy>,
): IToolResultRemediationPolicy {
  return {
    tool: "search_files",
    mode,
    maxRetries: 0,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
    ...overrides,
  };
}

// ============================================================================
// Outcome → event action mapping
// ============================================================================

Deno.test("tool_validation_logging: fail_closed outcome logs TOOL_VALIDATION_EVENT_FAIL_CLOSED", async () => {
  const logger = createMockLogger();
  const result: IRemediationResult = {
    outcome: REMEDIATION_OUTCOME_FAIL_CLOSED,
    failure: syntheticFailure,
    retriesAttempted: 0,
  };
  await logValidationResult("search_files", makePolicy(REMEDIATION_MODE_FAIL_CLOSED), result, logger);
  assertEquals(logger.events.length, 1);
  assertEquals(logger.events[0].action, TOOL_VALIDATION_EVENT_FAIL_CLOSED);
});

Deno.test("tool_validation_logging: escalated outcome logs TOOL_VALIDATION_EVENT_ESCALATED", async () => {
  const logger = createMockLogger();
  const result: IRemediationResult = {
    outcome: REMEDIATION_OUTCOME_ESCALATED,
    failure: syntheticFailure,
    retriesAttempted: 0,
  };
  await logValidationResult("search_files", makePolicy(REMEDIATION_MODE_ESCALATE_ONLY), result, logger);
  assertEquals(logger.events.length, 1);
  assertEquals(logger.events[0].action, TOOL_VALIDATION_EVENT_ESCALATED);
});

Deno.test("tool_validation_logging: retry_exhausted outcome logs TOOL_VALIDATION_EVENT_RETRY_EXHAUSTED", async () => {
  const logger = createMockLogger();
  const result: IRemediationResult = {
    outcome: REMEDIATION_OUTCOME_RETRY_EXHAUSTED,
    failure: syntheticFailure,
    retriesAttempted: 2,
  };
  await logValidationResult("search_files", makePolicy(REMEDIATION_MODE_RETRY_WITH_BACKOFF), result, logger);
  assertEquals(logger.events.length, 1);
  assertEquals(logger.events[0].action, TOOL_VALIDATION_EVENT_RETRY_EXHAUSTED);
});

Deno.test("tool_validation_logging: normalization_failed outcome logs TOOL_VALIDATION_EVENT_NORMALIZATION_FAILED", async () => {
  const logger = createMockLogger();
  const result: IRemediationResult = {
    outcome: REMEDIATION_OUTCOME_NORMALIZATION_FAILED,
    failure: syntheticFailure,
    retriesAttempted: 0,
  };
  await logValidationResult("search_files", makePolicy(REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE), result, logger);
  assertEquals(logger.events.length, 1);
  assertEquals(logger.events[0].action, TOOL_VALIDATION_EVENT_NORMALIZATION_FAILED);
});

Deno.test("tool_validation_logging: passed with retriesAttempted>0 logs TOOL_VALIDATION_EVENT_RETRY_SUCCESS", async () => {
  const logger = createMockLogger();
  const result: IRemediationResult = { outcome: REMEDIATION_OUTCOME_PASSED, failure: null, retriesAttempted: 1 };
  await logValidationResult("search_files", makePolicy(REMEDIATION_MODE_RETRY_WITH_BACKOFF), result, logger);
  assertEquals(logger.events.length, 1);
  assertEquals(logger.events[0].action, TOOL_VALIDATION_EVENT_RETRY_SUCCESS);
});

Deno.test("tool_validation_logging: passed with retriesAttempted=0 logs TOOL_VALIDATION_EVENT_NORMALIZATION_SUCCESS", async () => {
  const logger = createMockLogger();
  const result: IRemediationResult = { outcome: REMEDIATION_OUTCOME_PASSED, failure: null, retriesAttempted: 0 };
  await logValidationResult("search_files", makePolicy(REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE), result, logger);
  assertEquals(logger.events.length, 1);
  assertEquals(logger.events[0].action, TOOL_VALIDATION_EVENT_NORMALIZATION_SUCCESS);
});

// ============================================================================
// logValidationFailures=false suppresses logging
// ============================================================================

Deno.test("tool_validation_logging: logValidationFailures=false suppresses all events", async () => {
  const logger = createMockLogger();
  const result: IRemediationResult = {
    outcome: REMEDIATION_OUTCOME_FAIL_CLOSED,
    failure: syntheticFailure,
    retriesAttempted: 0,
  };
  await logValidationResult(
    "search_files",
    makePolicy(REMEDIATION_MODE_FAIL_CLOSED, { logValidationFailures: false }),
    result,
    logger,
  );
  assertEquals(logger.events.length, 0);
});

// ============================================================================
// Plan amendment integration
// ============================================================================

Deno.test("tool_validation_logging: triggerPlanAmendmentOnFailure=true with terminal outcome calls shouldAmend", async () => {
  const logger = createMockLogger();
  let amendmentTriggered = false;
  const mockAmendments: IPlanAmendmentService = {
    shouldAmend: (_trigger) => {
      amendmentTriggered = true;
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
  const ctx: IValidationReportContext = { planId: "plan-1", stepId: "step-1", amendments: mockAmendments };
  const result: IRemediationResult = {
    outcome: REMEDIATION_OUTCOME_RETRY_EXHAUSTED,
    failure: syntheticFailure,
    retriesAttempted: 2,
  };
  await logValidationResult(
    "search_files",
    makePolicy(REMEDIATION_MODE_RETRY_WITH_BACKOFF, { triggerPlanAmendmentOnFailure: true }),
    result,
    logger,
    ctx,
  );
  assertEquals(
    amendmentTriggered,
    true,
    "shouldAmend must be called when triggerPlanAmendmentOnFailure=true and outcome is terminal",
  );
});

Deno.test("tool_validation_logging: triggerPlanAmendmentOnFailure=true with passed outcome does not call shouldAmend", async () => {
  const logger = createMockLogger();
  let amendmentTriggered = false;
  const mockAmendments: IPlanAmendmentService = {
    shouldAmend: (_trigger) => {
      amendmentTriggered = true;
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
  const ctx: IValidationReportContext = { planId: "plan-1", stepId: "step-1", amendments: mockAmendments };
  const result: IRemediationResult = { outcome: REMEDIATION_OUTCOME_PASSED, failure: null, retriesAttempted: 1 };
  await logValidationResult(
    "search_files",
    makePolicy(REMEDIATION_MODE_RETRY_WITH_BACKOFF, { triggerPlanAmendmentOnFailure: true }),
    result,
    logger,
    ctx,
  );
  assertEquals(amendmentTriggered, false, "shouldAmend must NOT be called when outcome is passed");
});
