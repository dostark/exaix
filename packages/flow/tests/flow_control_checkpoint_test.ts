/**
 * @module FlowControlCheckpointTest
 * @path packages/flow/tests/flow_control_checkpoint_test.ts
 * @description Verifies typed control persistence and refusal of interrupted control execution.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ZFlowCheckpoint } from "@exaix/schemas/flow.ts";
import { FLOW_CHECKPOINT_SCHEMA_VERSION } from "@exaix/core";
import { FlowCheckpointService, FlowExecutionError, FlowRunner, GateEvaluator, StepContentHasher } from "@exaix/flow";
import { initTestDbService } from "@exaix/testing";
import { GATE_TRACE, GateTestLogger } from "./helpers/gate_controls.ts";
import { gateRetryFlow, RetryTestAgent, RetryTestJudge } from "./helpers/gate_retry_controls.ts";
for (const phase of ["rerunning", "evaluating"] as const) {
  Deno.test(`[checkpoint] interrupted ${phase} fails before body or judge calls`, async () => {
    const env = await initTestDbService();
    try {
      const flow = gateRetryFlow();
      const checkpointService = new FlowCheckpointService(env.config);
      const file = checkpointService.getCheckpointPath(GATE_TRACE);
      await Deno.mkdir(join(file, ".."), { recursive: true });
      const controlState = {
        gates: {
          gate: {
            gateId: "gate",
            bodyIds: ["draft"],
            evaluationCount: 1,
            nextIteration: 1,
            phase,
            fingerprint: "interrupted",
            ceiling: 10,
          },
        },
      };
      const checkpoint = {
        traceId: GATE_TRACE,
        schemaVersion: FLOW_CHECKPOINT_SCHEMA_VERSION,
        flowContentHash: await new StepContentHasher().computeFlowContentHash(flow),
        completedSteps: {},
        savedAt: new Date().toISOString(),
        controlState,
      };
      assertEquals(ZFlowCheckpoint.parse(checkpoint).controlState, controlState);
      await Deno.writeTextFile(file, JSON.stringify(checkpoint));
      const agent = new RetryTestAgent();
      const judge = new RetryTestJudge([0.2]);
      const error = await assertRejects(
        () =>
          new FlowRunner({
            config: env.config,
            agentExecutor: agent,
            gateEvaluator: new GateEvaluator(judge),
            checkpointService,
            eventLogger: new GateTestLogger(),
          })
            .execute(flow, { userPrompt: "Generate", traceId: GATE_TRACE }),
        FlowExecutionError,
      );
      assertEquals(error.reasonCode, "flow_control_resume_unsupported");
      assertEquals(agent.calls.length, 0);
      assertEquals(judge.calls, 0);
    } finally {
      await env.cleanup();
    }
  });
}

for (const drift of ["none", "request", "config", "body content", "ceiling"]) {
  Deno.test(`[checkpoint] settled gate restores its verdict with identity drift=${drift}`, async () => {
    const env = await initTestDbService();
    try {
      const flow = gateRetryFlow();
      const checkpointService = new FlowCheckpointService(env.config);
      const agent = new RetryTestAgent();
      const run = agent.run.bind(agent);
      agent.run = (role, request) =>
        request.flowStepId === "after" ? Promise.reject(new Error("Consumer interrupted")) : run(role, request);
      await assertRejects(
        () =>
          new FlowRunner({
            config: env.config,
            agentExecutor: agent,
            gateEvaluator: new GateEvaluator(new RetryTestJudge([0.2, 1])),
            checkpointService,
            eventLogger: new GateTestLogger(),
          })
            .execute(flow, { userPrompt: "Generate", traceId: GATE_TRACE }),
        FlowExecutionError,
      );
      const checkpoint = (await checkpointService.load(GATE_TRACE))!;
      assertEquals(checkpoint.controlState?.gates.gate.evaluationCount, 2);
      assertEquals(checkpoint.controlState?.gates.gate.phase, "settled");
      if (drift === "config") flow.steps[1].evaluate!.threshold = 0.9;
      if (drift === "ceiling") env.config.flow = { max_gate_evaluations: 4 };
      if (drift === "body content") {
        checkpoint.completedSteps.draft.result = { thought: "", content: "Changed", raw: "Changed" };
        await checkpointService.save(
          GATE_TRACE,
          checkpoint.flowContentHash,
          checkpoint.completedSteps,
          checkpoint.controlState,
        );
      }
      const judge = new RetryTestJudge([1]);
      const resumedAgent = new RetryTestAgent();
      const execute = () =>
        new FlowRunner({
          config: env.config,
          agentExecutor: resumedAgent,
          gateEvaluator: new GateEvaluator(judge),
          checkpointService,
          eventLogger: new GateTestLogger(),
        }).execute(flow, { userPrompt: drift === "request" ? "Different" : "Generate", traceId: GATE_TRACE });
      if (drift === "none") {
        assertEquals((await execute()).success, true);
        assertEquals(resumedAgent.requests.map((request) => request.flowStepId), ["after"]);
      } else {
        assertEquals((await assertRejects(execute, FlowExecutionError)).reasonCode, "flow_control_resume_unsupported");
        assertEquals(resumedAgent.calls.length, 0);
      }
      assertEquals(judge.calls, 0);
    } finally {
      await env.cleanup();
    }
  });
}
