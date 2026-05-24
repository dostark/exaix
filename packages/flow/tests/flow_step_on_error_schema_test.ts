/**
 * @module FlowStepOnErrorSchemaTest
 * @path tests/flows/flow_step_on_error_schema_test.ts
 * @description TDD tests for Phase 63 flow recovery schemas, including checkpoint schema versioning.
 * @architectural-layer Test
 * @related-files ["packages/schemas/src/flow.ts", .copilot/planning/phase-63-flow-error-recovery.md]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { FlowInputSource, FlowOutputFormat } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import { FlowSchema, ZFlowCheckpoint, ZFlowStepOnError } from "@exaix/schemas/flow.ts";
import {
  DEFAULT_FLOW_MAX_RETRIES,
  DEFAULT_FLOW_STEP_BACKOFF_MS,
  FLOW_CHECKPOINT_SCHEMA_VERSION,
  FLOW_MAX_RETRIES_MAX,
} from "@exaix/core";

Deno.test("ZFlowStepOnError parses all recovery action variants", () => {
  const retryResult = ZFlowStepOnError.parse({ action: "retry", maxRetries: 2 });
  assertEquals(retryResult.action, "retry");
  assertEquals(retryResult.maxRetries, 2);
  assertEquals(retryResult.backoffMs, DEFAULT_FLOW_STEP_BACKOFF_MS);

  const retryWithBackoff = ZFlowStepOnError.parse({ action: "retry", maxRetries: 2, backoffMs: 250 });
  assertEquals(retryWithBackoff.backoffMs, 250);

  const fallbackResult = ZFlowStepOnError.parse({ action: "fallback", fallbackStep: "repair" });
  assertEquals(fallbackResult.action, "fallback");
  assertEquals(fallbackResult.fallbackStep, "repair");

  const compensateResult = ZFlowStepOnError.parse({
    action: "compensate",
    compensate: [
      {
        tool: McpToolName.DELETE_FILE,
        params: { path: "src/generated/output.ts" },
      },
    ],
  });
  assertEquals(compensateResult.action, "compensate");
  assertEquals(compensateResult.compensate?.length, 1);

  const abortResult = ZFlowStepOnError.parse({ action: "abort" });
  assertEquals(abortResult.action, "abort");
  assertEquals(abortResult.maxRetries, DEFAULT_FLOW_MAX_RETRIES);
  assertThrows(() => ZFlowStepOnError.parse({ action: "retry", maxRetries: FLOW_MAX_RETRIES_MAX + 1 }));
});

Deno.test("FlowSchema keeps onError optional for existing flow definitions", () => {
  const flow = FlowSchema.parse({
    id: "existing-flow",
    name: "Existing Flow",
    description: "Flow definition predating recovery support",
    steps: [
      {
        id: "analyze",
        name: "Analyze",
        identity: "senior-coder",
        input: {
          source: FlowInputSource.REQUEST,
        },
      },
    ],
    output: {
      from: "analyze",
      format: FlowOutputFormat.MARKDOWN,
    },
  });

  assertEquals(flow.steps[0].id, "analyze");
  assertEquals(flow.steps[0].input.source, FlowInputSource.REQUEST);
});

Deno.test("ZFlowCheckpoint round-trips through JSON serialization", () => {
  const checkpoint = ZFlowCheckpoint.parse({
    traceId: "trace-123",
    flowContentHash: "sha256:abc123",
    completedSteps: {
      analyze: {
        stepId: "analyze",
        success: true,
        duration: 125,
        startedAt: new Date("2026-04-07T12:00:00.000Z"),
        completedAt: new Date("2026-04-07T12:00:00.125Z"),
      },
    },
    savedAt: "2026-04-07T12:00:01.000Z",
  });

  assertEquals(checkpoint.schemaVersion, FLOW_CHECKPOINT_SCHEMA_VERSION);

  const roundTrip = ZFlowCheckpoint.parse(JSON.parse(JSON.stringify(checkpoint)));
  assertEquals(roundTrip, checkpoint);
});
