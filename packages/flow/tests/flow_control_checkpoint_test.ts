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
import { BRANCH_TRACE, BranchTestAgent, branchTestFlow } from "./helpers/branch_controls.ts";
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
      assertEquals(ZFlowCheckpoint.parse(checkpoint).controlState, { ...controlState, branches: {} });
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

for (
  const drift of [
    "none",
    "missing",
    "chosen",
    "notTaken",
    "output",
    "request",
    "skipCode",
    "flow",
    "default model",
    "upstream",
    "upstream duration",
    "incomplete",
  ]
) {
  Deno.test(`[resume] branch route and exclusive skips survive restart with drift=${drift}`, async () => {
    const env = await initTestDbService();
    try {
      const flow = branchTestFlow();
      flow.steps[0].dependsOn = ["prior"];
      flow.steps.unshift({ ...flow.steps[1], id: "prior", name: "Prior", dependsOn: [] });
      const checkpointService = new FlowCheckpointService(env.config);
      const agent = new BranchTestAgent();
      const run = agent.run.bind(agent);
      agent.run = (role, request) =>
        request.flowStepId === "bug-child" ? Promise.reject(new Error("Consumer interrupted")) : run(role, request);
      await assertRejects(
        () =>
          new FlowRunner({
            config: env.config,
            checkpointService,
            agentExecutor: agent,
            eventLogger: new GateTestLogger(),
          }).execute(flow, { userPrompt: "Classify", traceId: BRANCH_TRACE }),
        FlowExecutionError,
      );
      const checkpoint = (await checkpointService.load(BRANCH_TRACE))!;
      assertEquals(checkpoint.controlState?.branches.classify.decision.chosen, "bug");
      assertEquals(checkpoint.completedSteps.feature.skipCode, "branch_not_taken");
      if (drift === "missing") checkpoint.controlState = undefined;
      if (drift === "chosen") checkpoint.controlState!.branches.classify.decision.chosen = "feature";
      if (drift === "notTaken") checkpoint.controlState!.branches.classify.decision.notTaken = [];
      if (drift === "output") checkpoint.controlState!.branches.classify.result.content = '{"category":"feature"}';
      if (drift === "skipCode") checkpoint.completedSteps.feature.skipCode = undefined;
      if (drift === "flow") flow.steps[1].branches![0].condition = "false";
      if (drift === "default model") env.config.ai = { ...env.config.ai, provider: "mock", model: "changed-model" };
      if (drift === "upstream") {
        checkpoint.completedSteps.prior.result = { thought: "", content: "Changed", raw: "Changed" };
      }
      if (drift === "upstream duration") checkpoint.completedSteps.prior.duration += 1;
      await checkpointService.save(
        BRANCH_TRACE,
        checkpoint.flowContentHash,
        checkpoint.completedSteps,
        checkpoint.controlState,
      );
      if (drift === "incomplete") {
        await Deno.writeTextFile(
          checkpointService.getCheckpointPath(BRANCH_TRACE),
          JSON.stringify(checkpoint).replace('"phase":"settled"', '"phase":"deciding"'),
        );
      }
      const resumedAgent = new BranchTestAgent();
      const logger = new GateTestLogger();
      const execute = () =>
        new FlowRunner({ config: env.config, checkpointService, agentExecutor: resumedAgent, eventLogger: logger })
          .execute(flow, { userPrompt: drift === "request" ? "Different" : "Classify", traceId: BRANCH_TRACE });
      if (drift === "none") {
        assertEquals((await execute()).success, true);
        assertEquals(resumedAgent.requests.map((request) => request.flowStepId), ["bug-child", "join"]);
        const event = logger.events.find((entry) => entry.event === "flow.branch.decided")!;
        assertEquals([event.payload.chosen, event.payload.restored, event.payload.traceId], [
          "bug",
          true,
          BRANCH_TRACE,
        ]);
      } else {
        assertEquals((await assertRejects(execute, FlowExecutionError)).reasonCode, "flow_control_resume_unsupported");
        assertEquals(resumedAgent.requests, []);
      }
    } finally {
      await env.cleanup();
    }
  });
}

Deno.test("[resume] decision saved before branch completion restores without a second model call", async () => {
  const env = await initTestDbService();
  try {
    const flow = branchTestFlow();
    const checkpointService = new FlowCheckpointService(env.config);
    const save = checkpointService.save.bind(checkpointService);
    checkpointService.save = async (...args) => {
      const checkpoint = await save(...args);
      if (checkpoint.controlState?.branches.classify && !checkpoint.completedSteps.classify) {
        throw new Error("Interrupted after the settled decision was saved");
      }
      return checkpoint;
    };
    const agent = new BranchTestAgent();
    await assertRejects(() =>
      new FlowRunner({ config: env.config, checkpointService, agentExecutor: agent, eventLogger: new GateTestLogger() })
        .execute(flow, { userPrompt: "Classify", traceId: BRANCH_TRACE })
    );
    assertEquals(agent.requests.map((request) => request.flowStepId), ["classify"]);
    const checkpoint = (await checkpointService.load(BRANCH_TRACE))!;
    assertEquals(checkpoint.completedSteps.classify, undefined);
    assertEquals(checkpoint.controlState?.branches.classify.decision.chosen, "bug");
    checkpointService.save = save;
    const resumed = new BranchTestAgent("unparseable if called");
    assertEquals(
      (await new FlowRunner({
        config: env.config,
        checkpointService,
        agentExecutor: resumed,
        eventLogger: new GateTestLogger(),
      }).execute(flow, { userPrompt: "Classify", traceId: BRANCH_TRACE })).success,
      true,
    );
    assertEquals(resumed.requests.map((request) => request.flowStepId), ["bug", "bug-child", "join"]);
  } finally {
    await env.cleanup();
  }
});

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
