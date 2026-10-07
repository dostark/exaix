/**
 * @module FlowRunnerGateHaltTest
 * @path packages/flow/tests/flow_runner_gate_halt_test.ts
 * @description Verifies terminal gate failures through step, wave, and run boundaries.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { FlowGateOnFail, FlowInputSource, FlowStepOnErrorAction } from "@exaix/core";
import { FlowExecutionError, FlowRunner, GateEvaluator, GateStepHandler } from "@exaix/flow";
import { GATE_TRACE, GateTestAgent, gateTestFlow, GateTestJudge, GateTestLogger } from "./helpers/gate_controls.ts";

for (const variant of ["default", "failFast false", "continue_on_error", "retry", "fallback", "compensate", "abort"]) {
  Deno.test(`[runner] a halted gate is terminal under ${variant}`, async () => {
    const flow = gateTestFlow();
    const agent = new GateTestAgent();
    const judge = new GateTestJudge();
    const logger = new GateTestLogger();
    if (variant === "failFast false") flow.settings.failFast = false;
    if (variant === "continue_on_error") {
      flow.steps[0].parallel = { group: "controls", continue_on_error: true, mergeMode: "all" };
      flow.steps.splice(1, 0, {
        ...flow.steps[1],
        id: "peer",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        parallel: { group: "controls", continue_on_error: true, mergeMode: "all" },
      });
    }
    const runner = new FlowRunner({
      agentExecutor: agent,
      eventLogger: logger,
      gateEvaluator: new GateEvaluator(judge),
    });
    if (["retry", "fallback", "compensate", "abort"].includes(variant)) {
      const execute = GateStepHandler.prototype.evaluateGate;
      GateStepHandler.prototype.evaluateGate = function (ctx, attempt) {
        ctx.step.onError = {
          action: variant === "retry"
            ? FlowStepOnErrorAction.RETRY
            : variant === "compensate"
            ? FlowStepOnErrorAction.COMPENSATE
            : variant === "abort"
            ? FlowStepOnErrorAction.ABORT
            : FlowStepOnErrorAction.FALLBACK,
          fallbackStep: "after",
          maxRetries: 1,
          backoffMs: 0,
        };
        return execute.call(this, ctx, attempt);
      };
      try {
        await assertTerminal();
      } finally {
        GateStepHandler.prototype.evaluateGate = execute;
      }
    } else await assertTerminal();
    async function assertTerminal(): Promise<void> {
      const error = await assertRejects(
        () => runner.execute(flow, { userPrompt: "Review this", traceId: GATE_TRACE }),
        FlowExecutionError,
      );
      assertEquals(error.reasonCode, "gate_halted");
      assertEquals(judge.calls, 1);
      assertEquals(
        logger.events.filter((entry) => entry.event === "flow.step.started" && entry.payload.stepId === "after"),
        [],
      );
      assertEquals(logger.events.find((entry) => entry.event === "flow.failed")?.payload.reasonCode, "gate_halted");
      assertEquals(logger.events.find((entry) => entry.event === "flow.failed")?.payload.traceId, GATE_TRACE);
    }
  });
}
Deno.test("[runner] warning continues through the downstream agent", async () => {
  const agent = new GateTestAgent();
  const logger = new GateTestLogger();
  const runner = new FlowRunner({
    agentExecutor: agent,
    eventLogger: logger,
    gateEvaluator: new GateEvaluator(new GateTestJudge()),
  });
  const result = await runner.execute(gateTestFlow(FlowGateOnFail.CONTINUE_WITH_WARNING), {
    userPrompt: "Review this",
    traceId: GATE_TRACE,
  });
  assertEquals(result.success, true);
  assertEquals(agent.calls, ["senior-coder"]);
});

Deno.test("[runner] gate dispatch calls evaluateGate without the generic execute wrapper", async () => {
  const execute = GateStepHandler.prototype.execute;
  GateStepHandler.prototype.execute = () => Promise.reject(new Error("Generic gate dispatch was used"));
  try {
    const judge = new GateTestJudge();
    const runner = new FlowRunner({
      agentExecutor: new GateTestAgent(),
      eventLogger: new GateTestLogger(),
      gateEvaluator: new GateEvaluator(judge),
    });
    await runner.execute(gateTestFlow(FlowGateOnFail.CONTINUE_WITH_WARNING), { userPrompt: "Review this" });
    assertEquals(judge.calls, 1);
  } finally {
    GateStepHandler.prototype.execute = execute;
  }
});
