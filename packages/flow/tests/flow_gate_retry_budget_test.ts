/**
 * @module FlowGateRetryBudgetTest
 * @path packages/flow/tests/flow_gate_retry_budget_test.ts
 * @description Verifies cumulative retry cost admission on the original request trace.
 */
import { DEFAULT_QUERY_LIMIT } from "@exaix/core";
import { assertEquals, assertRejects } from "@std/assert";
import { FlowExecutionError, FlowRunner, GateEvaluator } from "@exaix/flow";
import { initTestDbService } from "@exaix/testing";
import { GATE_TRACE, GateTestLogger } from "./helpers/gate_controls.ts";
import { gateRetryFlow, RetryTestAgent, RetryTestJudge } from "./helpers/gate_retry_controls.ts";
for (
  const mode of [
    "equality",
    "exceeded",
    "missing db",
    "missing trace",
    "query failure",
    "unknown cost",
    "missing cost",
    "invalid cost",
    "disabled",
  ]
) {
  Deno.test(`[budget] ${mode} admits no unbudgeted retry calls`, async () => {
    const env = await initTestDbService();
    try {
      env.config.max_flow_retry_cost_usd = mode === "disabled" ? 0 : 0.01;
      const usage = mode === "unknown cost"
        ? { cost_status: "unknown" }
        : mode === "missing cost"
        ? {}
        : { cost_usd: mode === "invalid cost" ? -0.01 : mode === "exceeded" ? 0.02 : 0.01 };
      env.db.logActivity("judge", "llm.usage", null, usage, GATE_TRACE);
      if (mode === "query failure") env.db.queryActivity = () => Promise.reject(new Error("Journal unavailable"));
      const judge = new RetryTestJudge([0.2, 1]);
      const agent = new RetryTestAgent();
      const flow = gateRetryFlow();
      flow.settings.failFast = false;
      const runner = new FlowRunner({
        config: env.config,
        db: mode === "missing db" ? undefined : env.db,
        agentExecutor: agent,
        gateEvaluator: new GateEvaluator(judge),
        eventLogger: new GateTestLogger(),
      });
      const execute = () =>
        runner.execute(flow, { userPrompt: "Generate", traceId: mode === "missing trace" ? undefined : GATE_TRACE });
      if (mode === "disabled") {
        assertEquals((await execute()).success, true);
        assertEquals(judge.calls, 2);
      } else {
        const error = await assertRejects(execute, FlowExecutionError);
        assertEquals(
          error.reasonCode,
          ["equality", "exceeded"].includes(mode) ? "flow_retry_budget_exceeded" : "flow_retry_budget_unavailable",
        );
        assertEquals(judge.calls, 1);
        assertEquals(agent.requests.length, 1);
      }
    } finally {
      await env.cleanup();
    }
  });
}

Deno.test("[budget] cumulative spend includes usage older than the journal default window", async () => {
  const env = await initTestDbService();
  try {
    env.config.max_flow_retry_cost_usd = 0.01;
    env.db.logActivity("body", "llm.usage", null, { cost_usd: 0.01 }, GATE_TRACE);
    await env.db.waitForFlush();
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    for (let index = 0; index <= DEFAULT_QUERY_LIMIT; index++) {
      env.db.logActivity("judge", "llm.usage", null, { cost_usd: 0 }, GATE_TRACE);
    }
    const agent = new RetryTestAgent();
    const judge = new RetryTestJudge([0.2, 1]);
    const error = await assertRejects(
      () =>
        new FlowRunner({
          config: env.config,
          db: env.db,
          agentExecutor: agent,
          gateEvaluator: new GateEvaluator(judge),
          eventLogger: new GateTestLogger(),
        })
          .execute(gateRetryFlow(), { userPrompt: "Generate", traceId: GATE_TRACE }),
      FlowExecutionError,
    );
    assertEquals(error.reasonCode, "flow_retry_budget_exceeded");
    assertEquals(agent.requests.length, 1);
    assertEquals(judge.calls, 1);
  } finally {
    await env.cleanup();
  }
});
