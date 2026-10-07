/**
 * @module AdvancedFlowContractsTest
 * @path tests/blueprints/advanced_flow_contracts_test.ts
 * @description Pins the shipped Phase 205 advanced blueprints to their planned data edges and overlays.
 * @architectural-layer Test
 * @dependencies [@exaix/flow, @exaix/schemas]
 * @related-files [packages/flow/src/loop_body.ts, packages/schemas/src/model_binding.ts]
 */
import { assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { computeLoopBody, FlowLoader, validateLoopBody } from "@exaix/flow";
import { BindingOverlaySchema } from "@exaix/schemas";

/** The gate fields the contract pins, with enum values compared as plain strings. */
interface IExpectedGate {
  agent_role: string;
  criteria: string[];
  threshold: number;
  onFail: string;
  maxRetries: number;
  includeRequestCriteria: boolean;
}

const FLOWS_DIR = "./Blueprints/Flows";
const OVERLAYS_DIR = "./configs/bindings/flows";
const SELF_CORRECTING = "self-correcting-implementation";

Deno.test("[contract] self-correcting implementation declares the planned edges, gate and settings", async () => {
  const flow = await new FlowLoader(FLOWS_DIR).loadFlow(SELF_CORRECTING);
  const edges = flow.steps.map((step) => ({
    id: step.id,
    type: step.type as string | undefined,
    role: step.agent_role,
    strategy: step.strategy as string | undefined,
    effort: step.effort,
    dependsOn: step.dependsOn,
    source: step.input.source as string,
    from: step.input.stepId ?? step.input.from,
    transform: step.input.transform as string,
  }));
  assertEquals(edges, [
    {
      id: "plan",
      type: "agent",
      role: "software-architect",
      strategy: undefined,
      effort: "high",
      dependsOn: [],
      source: "request",
      from: undefined,
      transform: "passthrough",
    },
    {
      id: "implement",
      type: "agent",
      role: "senior-coder",
      strategy: "react",
      effort: undefined,
      dependsOn: ["plan"],
      source: "step",
      from: "plan",
      transform: "passthrough",
    },
    {
      id: "write-tests",
      type: "agent",
      role: "test-engineer",
      strategy: "react",
      effort: undefined,
      dependsOn: ["implement"],
      source: "step",
      from: "implement",
      transform: "passthrough",
    },
    {
      id: "quality-gate",
      type: "gate",
      role: "quality-judge",
      strategy: undefined,
      effort: undefined,
      dependsOn: ["implement", "write-tests"],
      source: "aggregate",
      from: ["implement", "write-tests"],
      transform: "passthrough",
    },
    {
      id: "report",
      type: "agent",
      role: "technical-writer",
      strategy: undefined,
      effort: "low",
      dependsOn: ["quality-gate"],
      source: "aggregate",
      from: ["implement", "write-tests", "quality-gate"],
      transform: "passthrough",
    },
  ]);
  const gate = flow.steps.find((step) => step.id === "quality-gate")!;
  assertEquals(gate.evaluate as IExpectedGate | undefined, {
    agent_role: "quality-judge",
    criteria: ["code_correctness", "has_tests", "task_fulfillment"],
    threshold: 0.8,
    onFail: "retry",
    maxRetries: 2,
    includeRequestCriteria: false,
  });
  assertEquals(gate.loop?.backTo, "implement");
  assertEquals(computeLoopBody(flow, gate), ["implement", "write-tests"]);
  assertEquals(validateLoopBody(flow, gate), null);
  assertEquals(flow.namespace?.enabled, false);
  assertEquals(
    [flow.settings.maxParallelism, flow.settings.failFast, flow.settings.timeout],
    [1, true, 600000],
  );
  assertEquals([flow.output.from, flow.output.format as string], ["report", "markdown"]);
});

Deno.test("[contract] the self-correcting overlay binds plan and gate strong, the rest light", async () => {
  const raw = parseToml(await Deno.readTextFile(`${OVERLAYS_DIR}/${SELF_CORRECTING}.example.toml`));
  const overlay = BindingOverlaySchema.parse(raw);
  const services = Object.fromEntries(
    Object.entries(overlay.bindings ?? {}).map(([selector, binding]) => [selector, binding.service]),
  );
  const step = (id: string) => `flow:${SELF_CORRECTING}/step:${id}`;
  assertEquals(services, {
    [step("plan")]: "strong-service",
    [step("quality-gate")]: "strong-service",
    [step("implement")]: "light-service",
    [step("write-tests")]: "light-service",
    [step("report")]: "light-service",
  });
});
