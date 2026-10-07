/**
 * @module GateStepHandlerActionsTest
 * @path packages/flow/tests/step_handlers/gate_step_handler_actions_test.ts
 * @description Verifies typed gate evaluation, terminal halt, warning, and judge errors.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { FlowGateAction, FlowGateOnFail } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { FlowGateHaltedError, GateEvaluator, GateStepHandler } from "@exaix/flow";
import {
  GATE_FEEDBACK,
  GATE_SCORE,
  GATE_THRESHOLD,
  GATE_TRACE,
  gateTestContext,
  gateTestFlow,
  GateTestJudge,
  GateTestLogger,
} from "../helpers/gate_controls.ts";

Deno.test("[gate] halt throws FlowGateHaltedError carrying score, threshold and feedback", async () => {
  const handler = new GateStepHandler({
    gateEvaluator: new GateEvaluator(new GateTestJudge()),
    eventLogger: new GateTestLogger(),
  });
  const error = await assertRejects(() => handler.execute(gateTestContext()), FlowGateHaltedError);
  assertEquals([error.stepId, error.score, error.threshold, error.feedback, error.code], [
    "gate",
    GATE_SCORE,
    GATE_THRESHOLD,
    GATE_FEEDBACK,
    "gate_halted",
  ]);
});
Deno.test("[gate] halt never returns content, even when the judge errors", async () => {
  const judge = new GateTestJudge();
  judge.fail = true;
  const handler = new GateStepHandler({ gateEvaluator: new GateEvaluator(judge), eventLogger: new GateTestLogger() });
  const error = await assertRejects(() => handler.execute(gateTestContext()), FlowGateHaltedError);
  assertEquals(error.score, 0);
  assertEquals(error.feedback, "Evaluation failed: Judge unavailable");
});
Deno.test("[gate] continue-with-warning returns the feedback", async () => {
  const logger = new GateTestLogger();
  const handler = new GateStepHandler({ gateEvaluator: new GateEvaluator(new GateTestJudge()), eventLogger: logger });
  const result = await handler.execute(gateTestContext(gateTestFlow(FlowGateOnFail.CONTINUE_WITH_WARNING)));
  assertEquals(result.content, GATE_FEEDBACK);
  assertEquals(logger.events.at(-1)?.payload.action, FlowGateAction.CONTINUED_WITH_WARNING);
});
Deno.test("[gate] evaluateGate returns typed halt and emits score, threshold, passed, action and attempt", async () => {
  const logger = new GateTestLogger();
  const judge = new GateTestJudge();
  const handler = new GateStepHandler({ gateEvaluator: new GateEvaluator(judge), eventLogger: logger });
  const result = await handler.evaluateGate(gateTestContext(), 1);
  assertEquals(result.action, FlowGateAction.HALTED);
  const event = logger.events.find((entry) => entry.event === DomainEventType.FlowGateEvaluated);
  assertEquals(event?.payload, {
    flowRunId: "phase205-run",
    stepId: "gate",
    traceId: GATE_TRACE,
    requestId: undefined,
    score: GATE_SCORE,
    threshold: GATE_THRESHOLD,
    passed: false,
    action: FlowGateAction.HALTED,
    attempt: 1,
  });
  assertEquals(judge.calls, 1);
});
