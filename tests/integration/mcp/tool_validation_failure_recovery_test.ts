/**
 * @module ToolValidationFailureRecoveryTest
 * @path tests/integration/mcp/tool_validation_failure_recovery_test.ts
 * @description Integration tests verifying that tool validation failure logging and
 * remediation outcome events are correctly emitted when invoked from MCP context.
 * Tests the full chain: remediation result → logValidationResult → captured events.
 * (Phase 78 Step 78.4)
 */

import { assertEquals, assertExists } from "@std/assert";
import type { IEventLogger } from "@exaix/core/logger/event_logger.ts";
import type { ILogEvent } from "@exaix/core";
import {
  logValidationResult,
  TOOL_VALIDATION_EVENT_ESCALATED,
  TOOL_VALIDATION_EVENT_FAIL_CLOSED,
  TOOL_VALIDATION_EVENT_RETRY_EXHAUSTED,
} from "../../../src/services/tool/tool_validation_reporter.ts";
import {
  type IToolResultRemediationPolicy,
  REMEDIATION_MODE_ESCALATE_ONLY,
  REMEDIATION_MODE_FAIL_CLOSED,
  REMEDIATION_MODE_RETRY_ONCE,
} from "@exaix/schemas/tool_result.ts";
import type { IRemediationResult } from "@exaix/schemas/tool_result_remediation.ts";
import {
  REMEDIATION_OUTCOME_ESCALATED,
  REMEDIATION_OUTCOME_FAIL_CLOSED,
  REMEDIATION_OUTCOME_RETRY_EXHAUSTED,
} from "@exaix/schemas/tool_result_remediation.ts";
import type { IToolResultValidationFailure } from "@exaix/schemas/tool_result.ts";

interface ICapturedEvent {
  action: string;
  target: string;
}

function createSpyLogger(): IEventLogger & { events: ICapturedEvent[] } {
  const events: ICapturedEvent[] = [];
  const impl: IEventLogger = {
    log(event: ILogEvent): Promise<void> {
      events.push({ action: event.action, target: event.target });
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

const mcpToolFailure: IToolResultValidationFailure = {
  tool: "run_command",
  issues: [{ path: ["success"], message: "Expected boolean, received string", code: "invalid_type" }],
  rawResult: { success: "yes" },
};

function makePolicy(
  mode: IToolResultRemediationPolicy["mode"],
  overrides?: Partial<IToolResultRemediationPolicy>,
): IToolResultRemediationPolicy {
  return {
    tool: "run_command",
    mode,
    maxRetries: 1,
    requiresIdempotency: true,
    allowRetryAfterSideEffect: false,
    logValidationFailures: true,
    triggerPlanAmendmentOnFailure: false,
    ...overrides,
  };
}

Deno.test("tool_validation_failure_recovery_integration: fail_closed emits fail_closed event to journal", async () => {
  const logger = createSpyLogger();
  const result: IRemediationResult = {
    outcome: REMEDIATION_OUTCOME_FAIL_CLOSED,
    failure: mcpToolFailure,
    retriesAttempted: 0,
  };
  await logValidationResult("run_command", makePolicy(REMEDIATION_MODE_FAIL_CLOSED), result, logger);
  assertExists(logger.events.find((e) => e.action === TOOL_VALIDATION_EVENT_FAIL_CLOSED));
});

Deno.test("tool_validation_failure_recovery_integration: escalated outcome emits escalated event to journal", async () => {
  const logger = createSpyLogger();
  const result: IRemediationResult = {
    outcome: REMEDIATION_OUTCOME_ESCALATED,
    failure: mcpToolFailure,
    retriesAttempted: 0,
  };
  await logValidationResult("run_command", makePolicy(REMEDIATION_MODE_ESCALATE_ONLY), result, logger);
  assertExists(logger.events.find((e) => e.action === TOOL_VALIDATION_EVENT_ESCALATED));
});

Deno.test("tool_validation_failure_recovery_integration: retry_exhausted emits retry_exhausted event to journal", async () => {
  const logger = createSpyLogger();
  const result: IRemediationResult = {
    outcome: REMEDIATION_OUTCOME_RETRY_EXHAUSTED,
    failure: mcpToolFailure,
    retriesAttempted: 1,
  };
  await logValidationResult("run_command", makePolicy(REMEDIATION_MODE_RETRY_ONCE), result, logger);
  assertExists(logger.events.find((e) => e.action === TOOL_VALIDATION_EVENT_RETRY_EXHAUSTED));
});

Deno.test("tool_validation_failure_recovery_integration: tool name is included in event target", async () => {
  const logger = createSpyLogger();
  const result: IRemediationResult = {
    outcome: REMEDIATION_OUTCOME_FAIL_CLOSED,
    failure: mcpToolFailure,
    retriesAttempted: 0,
  };
  await logValidationResult("run_command", makePolicy(REMEDIATION_MODE_FAIL_CLOSED), result, logger);
  const event = logger.events[0];
  assertExists(event);
  assertEquals(event.target, "run_command");
});
