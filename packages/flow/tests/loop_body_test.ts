/**
 * @module LoopBodyTest
 * @path packages/flow/tests/loop_body_test.ts
 * @description Verifies dependency selection and safe retry body ownership.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { ExecutionStrategyName, FlowStepExecutionMode, FlowStepOnErrorAction, FlowStepType } from "@exaix/core";
import { computeLoopBody, validateLoopBody } from "@exaix/flow";
import { gateRetryFlow } from "./helpers/gate_retry_controls.ts";

Deno.test("[loop] computes every path from backTo to gate in topological order", () => {
  const flow = gateRetryFlow();
  flow.steps.splice(1, 0, { ...flow.steps[0], id: "second", dependsOn: ["draft"] });
  flow.steps[2].dependsOn = ["second", "draft"];
  assertEquals(computeLoopBody(flow, flow.steps[2]), ["draft", "second"]);
  delete flow.steps[2].loop;
  assertEquals(computeLoopBody(flow, flow.steps[2]), ["draft", "second"]);
});

for (
  const type of [
    FlowStepType.SESSION_DELEGATE_CYCLE,
    FlowStepType.VOTING_GROUP,
    FlowStepType.CONSENSUS,
    FlowStepType.GATE,
    FlowStepType.BRANCH,
  ]
) {
  Deno.test(`[security] [loop] rejects body type ${type}`, () => {
    const flow = gateRetryFlow();
    flow.steps[0].type = type;
    assertStringIncludes(validateLoopBody(flow, flow.steps[1]) ?? "", "agent");
  });
}

Deno.test("[loop] rejects empty body and a same-wave output consumer", () => {
  const flow = gateRetryFlow();
  flow.steps[1].loop!.backTo = "after";
  assertStringIncludes(validateLoopBody(flow, flow.steps[1]) ?? "", "non-empty");
  flow.steps[1].loop!.backTo = "draft";
  flow.steps.push({ ...flow.steps[0], id: "sibling", dependsOn: ["draft"] });
  assertStringIncludes(validateLoopBody(flow, flow.steps[1]) ?? "", "depend on the gate");
  flow.steps[3].dependsOn.push("gate");
  assertEquals(validateLoopBody(flow, flow.steps[1]), null);
});

Deno.test("[security] [loop] rejects CLI delegation, body recovery, repeated attempts and append writes", () => {
  const flow = gateRetryFlow();
  const body = flow.steps[0];
  body.strategy = ExecutionStrategyName.CLI_DELEGATE;
  assertStringIncludes(validateLoopBody(flow, flow.steps[1]) ?? "", "cli_delegate");
  delete body.strategy;
  body.onError = { action: FlowStepOnErrorAction.RETRY, maxRetries: 1, backoffMs: 0 };
  assertStringIncludes(validateLoopBody(flow, flow.steps[1]) ?? "", "retry owner");
  delete body.onError;
  body.retry.maxAttempts = 2;
  assertStringIncludes(validateLoopBody(flow, flow.steps[1]) ?? "", "retry owner");
  body.retry.maxAttempts = 1;
  body.namespace = { reads: [], writes: [{ key: "draft", mode: "append" }] };
  assertStringIncludes(validateLoopBody(flow, flow.steps[1]) ?? "", "append");
});

for (const strategy of [undefined, ExecutionStrategyName.REACT, ExecutionStrategyName.MCP]) {
  Deno.test(`[loop] accepts declared agent strategy ${strategy}`, () => {
    const flow = gateRetryFlow();
    flow.steps[0].strategy = strategy;
    assertEquals(validateLoopBody(flow, flow.steps[1]), null);
  });
}
Deno.test("[loop] accepts dynamic agents without a strategy", () => {
  const flow = gateRetryFlow();
  flow.steps[0].execution_mode = FlowStepExecutionMode.DYNAMIC;
  assertEquals(validateLoopBody(flow, flow.steps[1]), null);
});
