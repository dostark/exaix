/**
 * @module FlowCapabilitiesSchemaTest
 * @path packages/schemas/tests/flow_capabilities_schema_test.ts
 * @description Validates the supported capability allowlist on flow input.
 */
import { assertEquals } from "@std/assert";
import { FlowSchema } from "@exaix/schemas/flow.ts";
import { parse } from "@std/yaml";
import { FlowOutputFormat } from "@exaix/core";

const input = {
  id: "capability-flow",
  name: "Capability flow",
  description: "Requires installed voting",
  steps: [{ id: "first", name: "First", agent_role: "code-analyst" }],
  output: { from: "first" },
};
Deno.test("[schema] requires_capabilities survives parsing and legacy flows omit it", () => {
  assertEquals(FlowSchema.parse({ ...input, requires_capabilities: ["voting"] }).requires_capabilities, ["voting"]);
  assertEquals(FlowSchema.parse(input).requires_capabilities, undefined);
});
for (const capability of ["unknown", "hitl_governance", "model_registry_governance", "", "toString"]) {
  Deno.test(`[security] flow rejects unsupported capability ${capability}`, () => {
    const parsed = FlowSchema.safeParse({ ...input, requires_capabilities: [capability] });
    assertEquals(parsed.success, false);
    if (!parsed.success) assertEquals(parsed.error.issues[0].path, ["requires_capabilities", 0]);
  });
}

Deno.test("[schema] shipped architecture decision declares voting and concrete prepared input edges", async () => {
  const flow = FlowSchema.parse(
    parse(
      await Deno.readTextFile(new URL("../../../Blueprints/Flows/architecture-decision.flow.yaml", import.meta.url)),
    ),
  );
  assertEquals(flow.requires_capabilities, ["voting"]);
  assertEquals(flow.steps.map((step) => [step.id, step.dependsOn, step.input.source, step.input.stepId]), [
    ["context", [], "request", undefined],
    ["vote", ["context"], "step", "context"],
    ["adr", ["vote"], "step", "vote"],
  ]);
  assertEquals(flow.steps[0].strategy, "react");
  assertEquals(flow.steps[1].voting?.runners.map((runner) => runner.blueprint), Array(3).fill("software-architect"));
  assertEquals(flow.steps[1].voting?.strategy, "majority");
  assertEquals(flow.output, { from: "adr", format: FlowOutputFormat.MARKDOWN });
});
