/**
 * @module FlowRuntimeValidatorTest
 * @path packages/flow/tests/flow_runtime_validator_test.ts
 * @description Verifies rejection of gate recovery policies before execution.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { FlowStepOnErrorAction } from "@exaix/core";
import { FlowExecutionError, FlowRunner, FlowRuntimeValidator } from "@exaix/flow";
import { GateTestAgent, gateTestFlow, GateTestLogger } from "./helpers/gate_controls.ts";
Deno.test("[security] [validator] onError on a gate step is rejected", async () => {
  const flow = gateTestFlow();
  flow.steps[0].onError = { action: FlowStepOnErrorAction.RETRY, maxRetries: 1, backoffMs: 0 };
  assertEquals(
    new FlowRuntimeValidator().validateGatePolicies(flow),
    "Step 'gate': a gate's failure policy is evaluate.onFail",
  );
  const logger = new GateTestLogger();
  await assertRejects(
    () =>
      new FlowRunner({ agentExecutor: new GateTestAgent(), eventLogger: logger }).execute(flow, { userPrompt: "test" }),
    FlowExecutionError,
    "a gate's failure policy is evaluate.onFail",
  );
  assertEquals(logger.events.filter((entry) => entry.event === "flow.step.started"), []);
});

Deno.test("[validator] feedback input directs callers to gate retry", () => {
  const flow = gateTestFlow();
  flow.steps[1].input.source = "feedback" as typeof flow.steps[1]["input"]["source"];
  assertEquals(new FlowRuntimeValidator().validateGatePolicies(flow), "use a gate with onFail: retry and loop.backTo");
});
