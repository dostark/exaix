/**
 * @module FlowEventLoggerAdapterTest
 * @path apps/daemon/tests/flow_event_logger_adapter_test.ts
 * @description Phase 167 Step 3 — RED-first regression test for the FlowRunner ->
 *   IEventLogger adapter's trace_id correlation. Discovered live: a trace_scoped
 *   journal-assert against flow.step.started returned zero rows even though the
 *   event's own payload.traceId matched the request's real trace, because the
 *   inline adapter in apps/daemon/main.ts called logger.info(event, "flow-runner",
 *   payload) without forwarding the explicit 4th traceId argument -- EventLogger.log()
 *   falls back to crypto.randomUUID() for the persisted row's trace_id column
 *   whenever that argument is omitted, so every flow-lifecycle event journaled a
 *   random, request-uncorrelated trace_id.
 */

import { assertEquals } from "@std/assert";
import { createMockEventLogger } from "@exaix/testing";
import { createFlowEventLogger } from "../src/flow_event_logger_adapter.ts";

Deno.test("[FlowEventLoggerAdapter] forwards payload.traceId as the explicit traceId argument, not just a payload field", () => {
  const mockLogger = createMockEventLogger();
  const flowLogger = createFlowEventLogger(mockLogger);

  flowLogger.log("flow.step.started", {
    flowRunId: "run-1",
    stepId: "react-step",
    agentRole: "senior-coder",
    strategy: "react",
    traceId: "trace-abc",
    requestId: "request-abc",
  });

  assertEquals(mockLogger.events.length, 1);
  assertEquals(mockLogger.events[0].traceId, "trace-abc");
});

Deno.test("[FlowEventLoggerAdapter] forwards the event name and 'flow-runner' target unchanged", () => {
  const mockLogger = createMockEventLogger();
  const flowLogger = createFlowEventLogger(mockLogger);

  flowLogger.log("flow.completed", {
    flowRunId: "run-2",
    flowId: "some-flow",
    success: true,
    duration: 1200,
    stepsCompleted: 1,
    successfulSteps: 1,
    failedSteps: 0,
    outputLength: 42,
    traceId: "trace-xyz",
    requestId: "request-xyz",
  });

  assertEquals(mockLogger.events[0].action, "flow.completed");
  assertEquals(mockLogger.events[0].target, "flow-runner");
});

Deno.test("[FlowEventLoggerAdapter] still forwards the full payload object (not just traceId)", () => {
  const mockLogger = createMockEventLogger();
  const flowLogger = createFlowEventLogger(mockLogger);

  flowLogger.log("flow.step.started", {
    flowRunId: "run-3",
    stepId: "react-step",
    agentRole: "senior-coder",
    strategy: "react",
    traceId: "trace-def",
    requestId: "request-def",
  });

  assertEquals(mockLogger.events[0].payload?.stepId, "react-step");
  assertEquals(mockLogger.events[0].payload?.strategy, "react");
});

Deno.test("[FlowEventLoggerAdapter] a payload with no traceId forwards undefined rather than throwing", () => {
  const mockLogger = createMockEventLogger();
  const flowLogger = createFlowEventLogger(mockLogger);

  flowLogger.log("dynamic_step_event", { target: "dynamic_step" });

  assertEquals(mockLogger.events[0].traceId, undefined);
});
