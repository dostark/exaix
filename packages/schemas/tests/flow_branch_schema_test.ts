/**
 * @module FlowBranchSchemaTest
 * @path packages/schemas/tests/flow_branch_schema_test.ts
 * @description Rejects ambiguous branch policies and target graphs at the schema boundary.
 */
import { assertEquals } from "@std/assert";
import { FlowSchema } from "@exaix/schemas/flow.ts";
import type { JSONValue } from "@exaix/core";

const branch = {
  id: "classify",
  name: "Classify",
  agent_role: "code-analyst",
  type: "branch",
  branches: [{ condition: "true", goto: "bug" }],
  default: "bug",
};
function flow(step: JSONValue = branch, dependsOn = ["classify"]) {
  return {
    id: "triage",
    name: "Triage",
    description: "Classify issue",
    steps: [step, { id: "bug", name: "Bug", agent_role: "senior-coder", dependsOn }],
    output: { from: "bug" },
  };
}
Deno.test("[schema] declared triage branch accepts a dependent target", () => {
  assertEquals(FlowSchema.parse(flow()).steps[0].execution_mode, "declared");
});
for (
  const extra of [
    { strategy: "react" },
    { effort: "high" },
    { thinking: true },
    { execution_mode: "dynamic" },
    { condition: "true" },
    { onError: { action: "fallback", fallbackStep: "bug" } },
    { retry: { maxAttempts: 2 } },
  ]
) {
  Deno.test(`[security] schema rejects branch policy ${JSON.stringify(extra)}`, () => {
    assertEquals(FlowSchema.safeParse(flow({ ...branch, ...extra })).success, false);
  });
}
Deno.test("[schema] branch targets must directly depend on their branch", () => {
  assertEquals(FlowSchema.safeParse(flow(branch, [])).success, false);
  assertEquals(FlowSchema.safeParse(flow({ ...branch, default: "missing" })).success, false);
});
Deno.test("[schema] branches and default are restricted to branch steps", () => {
  assertEquals(FlowSchema.safeParse(flow({ ...branch, type: "agent" })).success, false);
});
Deno.test("[schema] generic gate retries cannot replace bounded evaluations", () => {
  assertEquals(FlowSchema.safeParse(flow({ ...branch, type: "gate", retry: { maxAttempts: 2 } })).success, false);
});
