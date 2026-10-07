/**
 * @module GateEvaluationLimitsTest
 * @path packages/flow/tests/gate_evaluation_limits_test.ts
 * @description Covers direct evaluator limits before warning conversion and captured runner ceilings.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { FlowGateOnFail } from "@exaix/core";
import { FlowExecutionError, FlowRunner, GateEvaluator, toGateConfig } from "@exaix/flow";
import { initTestDbService } from "@exaix/testing";
import { GateTestLogger } from "./helpers/gate_controls.ts";
import { gateRetryFlow, RetryTestAgent, RetryTestJudge } from "./helpers/gate_retry_controls.ts";
for (const mode of ["over ceiling", "invalid consumed count", "retry count one"]) {
  Deno.test(`[limits] direct evaluator rejects ${mode} outside its warning handler`, async () => {
    const judge = new RetryTestJudge([1]);
    const config = toGateConfig(gateRetryFlow().steps[1].evaluate!);
    config.onFail = mode === "retry count one" ? FlowGateOnFail.RETRY : FlowGateOnFail.CONTINUE_WITH_WARNING;
    if (mode === "over ceiling") config.maxRetries = 11;
    if (mode === "retry count one") config.maxRetries = 1;
    await assertRejects(() =>
      new GateEvaluator(judge).evaluate(config, "Draft", undefined, mode === "invalid consumed count" ? 3 : 0)
    );
    assertEquals(judge.calls, 0);
  });
}
Deno.test("[limits] configured lower ceiling rejects programmatic over-limit flows before calls", async () => {
  const env = await initTestDbService();
  try {
    env.config.flow = { max_gate_evaluations: 2 };
    const agent = new RetryTestAgent();
    const judge = new RetryTestJudge([1]);
    await assertRejects(
      () =>
        new FlowRunner({
          config: env.config,
          agentExecutor: agent,
          gateEvaluator: new GateEvaluator(judge),
          eventLogger: new GateTestLogger(),
        })
          .execute(gateRetryFlow(), { userPrompt: "Generate" }),
      FlowExecutionError,
    );
    assertEquals(agent.calls, []);
    assertEquals(judge.calls, 0);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[limits] configured ceiling is captured before the first judge call", async () => {
  const env = await initTestDbService();
  try {
    env.config.flow = { max_gate_evaluations: 2 };
    const judge = new RetryTestJudge([0.2]);
    const evaluate = judge.evaluate.bind(judge);
    judge.evaluate = (role, content, criteria) => {
      env.config.flow = { max_gate_evaluations: 100 };
      return evaluate(role, content, criteria);
    };
    const agent = new RetryTestAgent();
    assertEquals(
      (await assertRejects(() =>
        new FlowRunner({
          config: env.config,
          agentExecutor: agent,
          gateEvaluator: new GateEvaluator(judge),
          eventLogger: new GateTestLogger(),
        })
          .execute(gateRetryFlow(2), { userPrompt: "Generate", traceId: crypto.randomUUID() }), FlowExecutionError))
        .reasonCode,
      "gate_halted",
    );
    assertEquals(judge.calls, 2);
    assertEquals(agent.calls.length, 2);
  } finally {
    await env.cleanup();
  }
});
Deno.test("[limits] the default ceiling admits ten evaluations and exactly nine body retries", async () => {
  const agent = new RetryTestAgent();
  const judge = new RetryTestJudge([0.2]);
  assertEquals(
    (await assertRejects(() =>
      new FlowRunner({
        agentExecutor: agent,
        gateEvaluator: new GateEvaluator(judge),
        eventLogger: new GateTestLogger(),
      })
        .execute(gateRetryFlow(10), { userPrompt: "Generate" }), FlowExecutionError)).reasonCode,
    "gate_halted",
  );
  assertEquals(judge.calls, 10);
  assertEquals(agent.calls.length, 10);
});
