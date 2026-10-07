/**
 * @module BranchStepHandlerTest
 * @path packages/flow/tests/step_handlers/branch_step_handler_test.ts
 * @description Exercises routing decisions through the complete safe condition grammar.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { AgentStepHandler, BranchStepHandler, ConditionEvaluator, FlowControlError } from "@exaix/flow";
import type { IBranchExecutionResult, IStepExecutionContext } from "@exaix/flow";
import { BRANCH_OUTPUT, BRANCH_TRACE, BranchTestAgent, branchTestFlow } from "../helpers/branch_controls.ts";
import { GateTestLogger } from "../helpers/gate_controls.ts";

function fixture(output = BRANCH_OUTPUT) {
  const flow = branchTestFlow();
  const logger = new GateTestLogger();
  const agent = new BranchTestAgent(output);
  const conditionContext = new ConditionEvaluator().buildContext(new Map(), {
    userPrompt: "Classify",
    traceId: BRANCH_TRACE,
    requestId: "request-branch",
  }, flow);
  const ctx: IStepExecutionContext = {
    stepType: "branch",
    step: flow.steps[0],
    flow,
    request: conditionContext.request,
    stepRequest: { userPrompt: "Classify", context: {}, flowStepId: "classify", flowOutputKind: "branch-json" },
    flowRunId: "run-branch",
    startedAt: new Date(),
    flowLogBase: { flowId: flow.id },
    conditionContext,
  };
  const handler = new BranchStepHandler(new AgentStepHandler({ agentExecutor: agent }), logger);
  return { ctx, handler, conditionContext, logger };
}

Deno.test("[branch] first matching condition wins and duplicate chosen targets are never skipped", async () => {
  const { ctx, handler, conditionContext, logger } = fixture();
  ctx.step.branches!.push({ condition: "true", goto: "bug" });
  const result: IBranchExecutionResult = await handler.decideBranch(ctx, conditionContext);
  assertEquals(result.decision, {
    branchId: "classify",
    chosen: "bug",
    notTaken: ["feature", "other"],
    data: { category: "bug", items: [1, 2] },
  });
  assertEquals(logger.events.map((entry) => [entry.event, entry.payload.chosen, entry.payload.traceId]), [[
    "flow.branch.decided",
    "bug",
    BRANCH_TRACE,
  ]]);
});
for (const output of ['{"category":"other"}', '```json\n{"category":"other"}\n```', '{category: "other",}']) {
  Deno.test(`[branch] default applies to parsed or repaired output ${output}`, async () => {
    const { ctx, handler, conditionContext } = fixture(output);
    const decision = (await handler.decideBranch(ctx, conditionContext)).decision;
    assertEquals(decision.chosen, "other");
    assertEquals(decision.data, { category: "other" });
  });
}
Deno.test("[branch] an inline JSON fence can contain a classification array", async () => {
  const { ctx, handler, conditionContext } = fixture('```json["bug"]```');
  ctx.step.branches = [{ condition: "results.classify.data[0] === 'bug'", goto: "bug" }];
  const decision = (await handler.decideBranch(ctx, conditionContext)).decision;
  assertEquals(decision.chosen, "bug");
  assertEquals(decision.data, ["bug"]);
});
for (
  const [output, condition, expected] of [
    ["not JSON", "true", "branch_output_unparseable"],
    [BRANCH_OUTPUT, "missing.value", "branch_condition_error"],
    [BRANCH_OUTPUT, "false", "branch_no_match"],
  ] as const
) {
  Deno.test(`[branch] ${expected} fails terminally without a default decision`, async () => {
    const { ctx, handler, conditionContext, logger } = fixture(output);
    ctx.step.branches = [{ condition, goto: "bug" }];
    if (expected === "branch_no_match") ctx.step.default = undefined;
    assertEquals(
      (await assertRejects(() => handler.decideBranch(ctx, conditionContext), FlowControlError)).code,
      expected,
    );
    assertEquals(logger.events, []);
  });
}
Deno.test("[branch] registry execution requires the prepared condition context", async () => {
  const { ctx, handler } = fixture();
  assertEquals((await handler.execute(ctx)).content, BRANCH_OUTPUT);
  assertEquals(
    (await assertRejects(() => handler.execute({ ...ctx, conditionContext: undefined }), FlowControlError)).code,
    "branch_condition_error",
  );
});
const expressions = [
  "results.classify.data.category === 'bug'",
  "steps.some(s => s.id === 'classify')",
  "request.userPrompt === 'Classify'",
  "flow.name === 'Branch routing' && flow.version === '1.0.0'",
  "results.classify?.data.category === 'bug'",
  "results['classify'].data['category'] === 'bug'",
  "results.classify.data?.['category'] === 'bug'",
  "results.classify.data.absent?.value == null",
  "results.classify.data.category.length === 3",
  "results.classify.data.items.length === 2",
  "1 === 1",
  "'value' === 'value'",
  "true",
  "!false",
  "null === null",
  "[1,2].length === 2",
  "[1,2].every(x => x > 0)",
  "[1,2].every((x,unused) => x > 0)",
  "[1,2].some(x => x === 2)",
  "[1,2].includes(2)",
  "-1 < 0",
  "1 !== 2",
  "1 == '1'",
  "1 != 2",
  "1 < 2",
  "2 > 1",
  "1 <= 1",
  "2 >= 2",
  "1 + 2 === 3",
  "3 - 1 === 2",
  "2 * 3 === 6",
  "6 / 2 === 3",
  "5 % 2 === 1",
  "true && true",
  "false || true",
  "true ? true : false",
];
for (const condition of expressions) {
  Deno.test(`[branch grammar] ${condition}`, async () => {
    const { ctx, handler, conditionContext } = fixture();
    ctx.step.branches = [{ condition, goto: "bug" }];
    assertEquals((await handler.decideBranch(ctx, conditionContext)).decision.chosen, "bug");
  });
}
