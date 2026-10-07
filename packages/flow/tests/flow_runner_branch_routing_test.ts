/**
 * @module FlowRunnerBranchRoutingTest
 * @path packages/flow/tests/flow_runner_branch_routing_test.ts
 * @description Verifies run-local routing, selective skip propagation, and terminal branch failures.
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { FlowInputSource, FlowStepExecutionMode, FlowStepOnErrorAction } from "@exaix/core";
import { BranchStepHandler, FlowExecutionError, FlowRunner } from "@exaix/flow";
import { BRANCH_OUTPUT, BRANCH_TRACE, BranchTestAgent, branchTestFlow } from "./helpers/branch_controls.ts";
import { gateTestFlow, GateTestLogger } from "./helpers/gate_controls.ts";

Deno.test("[runner] branch skips all unchosen pipelines and aggregates only the taken path", async () => {
  const flow = branchTestFlow();
  const agent = new BranchTestAgent();
  const logger = new GateTestLogger();
  const result = await new FlowRunner({ agentExecutor: agent, eventLogger: logger }).execute(flow, {
    userPrompt: "Classify",
    traceId: BRANCH_TRACE,
  });
  assertEquals(agent.requests.map((request) => request.flowStepId), ["classify", "bug", "bug-child", "join"]);
  assertStringIncludes(agent.requests.at(-1)!.userPrompt, "Output bug-child");
  assertEquals(agent.requests.at(-1)!.userPrompt.includes("Output feature"), false);
  assertEquals(agent.requests.at(-1)!.userPrompt.includes("Output other"), false);
  for (const id of ["feature", "other", "feature-child", "other-child"]) {
    assertEquals(result.stepResults.get(id)?.skipCode, "branch_not_taken");
  }
  assertEquals(
    logger.events.filter((entry) => entry.event === "flow.branch.decided").map((entry) => entry.payload.chosen),
    ["bug"],
  );
  assertEquals(result.success, true);
});
Deno.test("[runner] direct and all-skipped aggregate inputs skip despite an unskipped dependency", async () => {
  const flow = branchTestFlow();
  const join = flow.steps.at(-1)!;
  for (const source of [FlowInputSource.STEP, FlowInputSource.AGGREGATE]) {
    join.dependsOn = ["bug", "feature"];
    join.input = { source, stepId: "feature", from: ["feature", "other"], transform: "passthrough" };
    const agent = new BranchTestAgent();
    const result = await new FlowRunner({ agentExecutor: agent, eventLogger: new GateTestLogger() }).execute(flow, {
      userPrompt: "Classify",
    });
    assertEquals(result.stepResults.get("join")?.skipCode, "branch_not_taken");
    assertEquals(agent.requests.some((request) => request.flowStepId === "join"), false);
  }
});
Deno.test("[runner] condition skips retain legacy non-propagating behavior and missing-input errors", async () => {
  const flow = branchTestFlow();
  flow.steps[1].condition = "false";
  flow.steps[4].input = { source: FlowInputSource.REQUEST, transform: "passthrough" };
  const agent = new BranchTestAgent();
  const result = await new FlowRunner({ agentExecutor: agent, eventLogger: new GateTestLogger() }).execute(flow, {
    userPrompt: "Classify",
  });
  assertEquals(result.stepResults.get("bug")?.skipCode, "condition");
  assertEquals(agent.requests.some((request) => request.flowStepId === "bug-child"), true);
  flow.steps[4].input = { source: FlowInputSource.AGGREGATE, from: ["bug"], transform: "passthrough" };
  await assertRejects(
    () =>
      new FlowRunner({ agentExecutor: new BranchTestAgent(), eventLogger: new GateTestLogger() }).execute(flow, {
        userPrompt: "Classify",
      }),
    FlowExecutionError,
    "has no result",
  );
});
Deno.test("[branch context] prior results and flow metadata reach routing", async () => {
  const flow = branchTestFlow();
  flow.steps[0].dependsOn = ["prior"];
  flow.steps[0].branches = [{
    condition:
      "results.prior.content === 'Output prior' && steps.some(s => s.id === 'prior') && flow.name === 'Branch routing' && flow.version === '1.0.0' && request.userPrompt === 'Classify'",
    goto: "bug",
  }];
  flow.steps.unshift({ ...flow.steps[1], id: "prior", name: "Prior", dependsOn: [] });
  const logger = new GateTestLogger();
  await new FlowRunner({ agentExecutor: new BranchTestAgent(), eventLogger: logger }).execute(flow, {
    userPrompt: "Classify",
  });
  assertEquals(logger.events.find((entry) => entry.event === "flow.branch.decided")?.payload.chosen, "bug");
});
Deno.test("[branch context] concurrent requests keep independent decisions", async () => {
  const agent = new BranchTestAgent();
  const run = agent.run.bind(agent);
  agent.run = (role, request) =>
    request.flowStepId === "classify"
      ? Promise.resolve({ thought: "", content: JSON.stringify({ category: request.traceId }), raw: "" })
      : run(role, request);
  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: new GateTestLogger() });
  const results = await Promise.all(
    ["bug", "feature"].map((traceId) => runner.execute(branchTestFlow(), { userPrompt: "Classify", traceId })),
  );
  assertEquals(
    results.map((
      result,
    ) => [result.stepResults.get("bug")?.skipped ?? false, result.stepResults.get("feature")?.skipped ?? false]),
    [[false, true], [true, false]],
  );
});
for (const mode of ["failFast false", "continue_on_error", "fallback bypass"]) {
  Deno.test(`[runner] branch parsing failure is terminal under ${mode}`, async () => {
    const flow = branchTestFlow();
    flow.settings.failFast = false;
    if (mode === "continue_on_error") {
      flow.steps[0].parallel = { group: "controls", continue_on_error: true, mergeMode: "all" };
    }
    const decide = BranchStepHandler.prototype.decideBranch;
    if (mode === "fallback bypass") {
      BranchStepHandler.prototype.decideBranch = function (ctx, context) {
        ctx.step.onError = { action: FlowStepOnErrorAction.FALLBACK, fallbackStep: "bug", maxRetries: 1, backoffMs: 0 };
        return decide.call(this, ctx, context);
      };
    }
    try {
      const agent = new BranchTestAgent("not JSON");
      const logger = new GateTestLogger();
      const error = await assertRejects(
        () =>
          new FlowRunner({ agentExecutor: agent, eventLogger: logger }).execute(flow, {
            userPrompt: "Classify",
            traceId: BRANCH_TRACE,
          }),
        FlowExecutionError,
      );
      assertEquals(error.reasonCode, "branch_output_unparseable");
      assertEquals(agent.requests.map((request) => request.flowStepId), ["classify"]);
      assertEquals(
        logger.events.find((entry) => entry.event === "flow.failed")?.payload.reasonCode,
        "branch_output_unparseable",
      );
    } finally {
      BranchStepHandler.prototype.decideBranch = decide;
    }
  });
}
for (const policy of ["dynamic", "effort", "thinking", "condition", "fallback", "retry"]) {
  Deno.test(`[security] runtime rejects programmatic branch ${policy} before model dispatch`, async () => {
    const flow = branchTestFlow();
    const step = flow.steps[0];
    if (policy === "dynamic") step.execution_mode = FlowStepExecutionMode.DYNAMIC;
    if (policy === "effort") step.effort = "high";
    if (policy === "thinking") step.thinking = true;
    if (policy === "condition") step.condition = "false";
    if (policy === "fallback") {
      step.onError = { action: FlowStepOnErrorAction.FALLBACK, fallbackStep: "bug", maxRetries: 1, backoffMs: 0 };
    }
    if (policy === "retry") step.retry.maxAttempts = 2;
    const agent = new BranchTestAgent();
    await assertRejects(
      () =>
        new FlowRunner({ agentExecutor: agent, eventLogger: new GateTestLogger() }).execute(flow, {
          userPrompt: "Classify",
        }),
      FlowExecutionError,
      policy === "retry" ? "Control steps cannot use generic retries" : "must be a declared single call",
    );
    assertEquals(agent.requests, []);
  });
}

for (const code of ["branch_condition_error", "branch_no_match"]) {
  Deno.test(`[runner] ${code} defeats failFast=false and parallel continuation`, async () => {
    const flow = branchTestFlow();
    flow.settings.failFast = false;
    flow.steps[0].parallel = { group: "controls", continue_on_error: true, mergeMode: "all" };
    flow.steps[0].branches = [{
      condition: code === "branch_condition_error" ? "missing.value" : "false",
      goto: "bug",
    }];
    flow.steps[0].default = undefined;
    const agent = new BranchTestAgent(BRANCH_OUTPUT);
    const logger = new GateTestLogger();
    assertEquals(
      (await assertRejects(() =>
        new FlowRunner({ agentExecutor: agent, eventLogger: logger })
          .execute(flow, { userPrompt: "Classify" }), FlowExecutionError)).reasonCode,
      code,
    );
    assertEquals(agent.requests.map((request) => request.flowStepId), ["classify"]);
    assertEquals(logger.events.find((entry) => entry.event === "flow.failed")?.payload.reasonCode, code);
  });
}
Deno.test("[security] runtime rejects generic gate retries before judge execution", async () => {
  const flow = gateTestFlow();
  flow.steps[0].retry.maxAttempts = 2;
  await assertRejects(
    () =>
      new FlowRunner({ agentExecutor: new BranchTestAgent(), eventLogger: new GateTestLogger() })
        .execute(flow, { userPrompt: "Review" }),
    FlowExecutionError,
    "Control steps cannot use generic retries",
  );
});
