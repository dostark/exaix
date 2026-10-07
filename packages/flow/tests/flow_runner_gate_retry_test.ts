/**
 * @module FlowRunnerGateRetryTest
 * @path packages/flow/tests/flow_runner_gate_retry_test.ts
 * @description Verifies bounded gate-owned retry execution and feedback routing.
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { FlowOutputFormat } from "@exaix/core";
import { initTestDbService } from "@exaix/testing";
import { FlowExecutionError, FlowNamespaceCoordinator, FlowRunner, GateEvaluator } from "@exaix/flow";
import { GATE_FEEDBACK, GATE_TRACE, GateTestLogger } from "./helpers/gate_controls.ts";
import { gateRetryFlow, RetryTestAgent, RetryTestJudge, twoMemberRetryFlow } from "./helpers/gate_retry_controls.ts";

Deno.test("[runner] retry runs the body with feedback and passes on evaluation two", async () => {
  const agent = new RetryTestAgent();
  const judge = new RetryTestJudge([0.2, 1]);
  const logger = new GateTestLogger();
  const flow = gateRetryFlow();
  Reflect.deleteProperty(flow.steps[1].evaluate!, "maxRetries");
  const result = await new FlowRunner({
    agentExecutor: agent,
    gateEvaluator: new GateEvaluator(judge),
    eventLogger: logger,
  })
    .execute(flow, { userPrompt: "Generate", traceId: GATE_TRACE });
  assertEquals(result.success, true);
  assertEquals(judge.calls, 2);
  assertEquals(agent.requests.length, 3);
  assertEquals(agent.requests[1].context.gateFeedback, GATE_FEEDBACK);
  assertStringIncludes(agent.requests[1].userPrompt, GATE_FEEDBACK);
  assertEquals(agent.requests[2].context.gateFeedback, undefined);
  assertEquals(judge.contents[1].includes("draft 2"), true);
  const loopEvents = logger.events.filter((entry) => entry.event === "flow.loop.iteration");
  assertEquals(loopEvents.length, 1);
  assertEquals(loopEvents[0].payload.maxRetries, 3);
  assertEquals(
    logger.events.filter((entry) => entry.event === "flow.gate.evaluated").map((entry) => entry.payload.attempt),
    [1, 2],
  );
});
Deno.test("[loop] exhausted retries consume three evaluations and two body iterations", async () => {
  const agent = new RetryTestAgent();
  const judge = new RetryTestJudge([0.2]);
  const logger = new GateTestLogger();
  const flow = gateRetryFlow();
  flow.settings.failFast = false;
  const error = await assertRejects(
    () =>
      new FlowRunner({ agentExecutor: agent, gateEvaluator: new GateEvaluator(judge), eventLogger: logger })
        .execute(flow, { userPrompt: "Generate", traceId: GATE_TRACE }),
    FlowExecutionError,
  );
  assertEquals(error.reasonCode, "gate_halted");
  assertEquals(judge.calls, 3);
  assertEquals(agent.requests.length, 3);
  assertEquals(logger.events.filter((entry) => entry.event === "flow.loop.iteration").length, 2);
});
for (const maxRetries of [1, 11, 1_000_000_000]) {
  Deno.test(`[limits] programmatic retry count ${maxRetries} is rejected before calls`, async () => {
    const flow = gateRetryFlow();
    flow.steps[1].evaluate!.maxRetries = maxRetries;
    const agent = new RetryTestAgent();
    const judge = new RetryTestJudge([1]);
    await assertRejects(
      () =>
        new FlowRunner({
          agentExecutor: agent,
          gateEvaluator: new GateEvaluator(judge),
          eventLogger: new GateTestLogger(),
        })
          .execute(flow, { userPrompt: "Generate" }),
      FlowExecutionError,
    );
    assertEquals(agent.calls.length, 0);
    assertEquals(judge.calls, 0);
  });
}

for (const mode of ["failed", "skipped"]) {
  Deno.test(`[lifecycle] a ${mode} middle member stops without another judge`, async () => {
    const flow = twoMemberRetryFlow();
    const agent = new RetryTestAgent();
    const originalRun = agent.run.bind(agent);
    agent.run = (role, request) =>
      request.flowStepId === "middle" && request.context.loopIteration !== undefined && mode === "failed"
        ? Promise.reject(new Error("Body failed"))
        : originalRun(role, request);
    if (mode === "skipped") flow.steps[1].condition = 'results.draft.content == "draft 1"';
    const judge = new RetryTestJudge([0.2, 1]);
    const error = await assertRejects(
      () =>
        new FlowRunner({
          agentExecutor: agent,
          gateEvaluator: new GateEvaluator(judge),
          eventLogger: new GateTestLogger(),
        })
          .execute(flow, { userPrompt: "Generate", traceId: GATE_TRACE }),
      FlowExecutionError,
    );
    assertEquals(error.reasonCode, `gate_loop_body_${mode}`);
    assertEquals(judge.calls, 1);
    assertEquals(agent.requests.filter((request) => request.flowStepId === "after").length, 0);
  });
}
Deno.test("[lifecycle] all members have iteration identity and only backTo receives feedback", async () => {
  const agent = new RetryTestAgent();
  const judge = new RetryTestJudge([0.2, 0.2, 1]);
  const flow = twoMemberRetryFlow();
  await new FlowRunner({
    agentExecutor: agent,
    gateEvaluator: new GateEvaluator(judge),
    eventLogger: new GateTestLogger(),
  })
    .execute(flow, { userPrompt: "Generate", traceId: GATE_TRACE });
  assertEquals(
    agent.requests.filter((request) => request.flowStepId === "middle").map((request) => request.context.loopIteration),
    [undefined, 1, 2],
  );
  assertEquals(
    agent.requests.filter((request) => request.flowStepId === "middle").map((request) => request.context.gateFeedback),
    [undefined, undefined, undefined],
  );
});
Deno.test("[lifecycle] retry writes are published before preparing the next body member", async () => {
  const env = await initTestDbService();
  try {
    const flow = twoMemberRetryFlow();
    flow.namespace = { enabled: true, format: FlowOutputFormat.MARKDOWN, maxBytes: 4096 };
    flow.steps[0].namespace = { reads: [], writes: [{ key: "draft", mode: "write" }] };
    flow.steps[1].namespace = { reads: [{ key: "draft", required: true }], writes: [] };
    const agent = new RetryTestAgent();
    await new FlowRunner({
      config: env.config,
      agentExecutor: agent,
      gateEvaluator: new GateEvaluator(new RetryTestJudge([0.2, 1])),
      eventLogger: new GateTestLogger(),
    })
      .execute(flow, { userPrompt: "Generate", traceId: GATE_TRACE });
    const middle = agent.requests.filter((request) => request.flowStepId === "middle");
    assertEquals(middle.map((request) => request.sharedNamespace?.draft), ["draft 1", "draft 3"]);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[lifecycle] retry persistence failure stops the gate even with failFast disabled", async () => {
  const flow = twoMemberRetryFlow();
  flow.settings.failFast = false;
  const judge = new RetryTestJudge([0.2, 1]);
  const agent = new RetryTestAgent();
  const persist = FlowNamespaceCoordinator.prototype.persistWaveNamespaceWrites;
  FlowNamespaceCoordinator.prototype.persistWaveNamespaceWrites = function (result, ...args) {
    if (result.stepId === "middle" && result.waveIndex === undefined) {
      return Promise.reject(new Error("Write unavailable"));
    }
    return persist.call(this, result, ...args);
  };
  try {
    assertEquals(
      (await assertRejects(() =>
        new FlowRunner({
          agentExecutor: agent,
          gateEvaluator: new GateEvaluator(judge),
          eventLogger: new GateTestLogger(),
        })
          .execute(flow, { userPrompt: "Generate" }), FlowExecutionError)).reasonCode,
      "gate_loop_body_failed",
    );
    assertEquals(judge.calls, 1);
    assertEquals(agent.requests.filter((request) => request.flowStepId === "after").length, 0);
  } finally {
    FlowNamespaceCoordinator.prototype.persistWaveNamespaceWrites = persist;
  }
});
