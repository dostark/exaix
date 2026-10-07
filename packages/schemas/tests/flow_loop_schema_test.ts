/**
 * @module FlowLoopSchemaTest
 * @path packages/schemas/tests/flow_loop_schema_test.ts
 * @description Verifies gate loop field ownership and bounded evaluation schemas.
 */
import { assertEquals } from "@std/assert";
import { FlowSchema, GateEvaluateSchema } from "@exaix/schemas/flow.ts";
import { GateConfigSchema } from "@exaix/flow";

const flow = {
  id: "loop-schema",
  name: "Loop schema",
  description: "Gate retry contracts",
  steps: [{
    id: "gate",
    name: "Gate",
    agent_role: "code-reviewer",
    type: "gate",
    input: { source: "request" },
    evaluate: { agent_role: "code-reviewer", criteria: ["CODE_CORRECTNESS"], onFail: "retry", maxRetries: 3 },
    loop: { backTo: "draft" },
  }],
  output: { from: "gate", format: "markdown" },
};
Deno.test("[schema] gate backTo has no independent iteration or score defaults", () => {
  assertEquals<unknown>(FlowSchema.parse(flow).steps[0].loop, { backTo: "draft" });
});
for (const loop of [{ maxIterations: 2 }, { targetScore: 0.9 }]) {
  Deno.test(`[schema] rejects redundant gate loop controls ${JSON.stringify(loop)}`, () => {
    assertEquals(FlowSchema.safeParse({ ...flow, steps: [{ ...flow.steps[0], loop }] }).success, false);
  });
}
Deno.test("[schema] rejects loop on a non-gate and retry with one evaluation", () => {
  assertEquals(FlowSchema.safeParse({ ...flow, steps: [{ ...flow.steps[0], type: "agent" }] }).success, false);
  assertEquals(
    FlowSchema.safeParse({
      ...flow,
      steps: [{ ...flow.steps[0], evaluate: { ...flow.steps[0].evaluate, maxRetries: 1 } }],
    }).success,
    false,
  );
});
for (const maxRetries of [10, 11, 1_000_000_000]) {
  Deno.test(`[limits] both gate schemas bound maxRetries=${maxRetries}`, () => {
    assertEquals(GateEvaluateSchema.safeParse({ ...flow.steps[0].evaluate, maxRetries }).success, maxRetries === 10);
    assertEquals(
      GateConfigSchema.safeParse({ agentRole: "code-reviewer", criteria: [], maxRetries }).success,
      maxRetries === 10,
    );
  });
}
Deno.test("[limits] gate evaluation default remains three", () => {
  assertEquals(GateEvaluateSchema.parse({ agent_role: "code-reviewer", criteria: [] }).maxRetries, 3);
  assertEquals(GateConfigSchema.parse({ agentRole: "code-reviewer", criteria: [] }).maxRetries, 3);
});
