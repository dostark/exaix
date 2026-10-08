/**
 * @module AdvancedFlowContractsTest
 * @path tests/blueprints/advanced_flow_contracts_test.ts
 * @description Pins the shipped Phase 205 advanced blueprints to their planned data edges and overlays.
 * @architectural-layer Test
 * @dependencies [@exaix/flow, @exaix/schemas, @exaix/execution]
 * @related-files [packages/flow/src/loop_body.ts, packages/schemas/src/model_binding.ts]
 */
import { assertEquals, assertExists } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { parse as parseToml } from "@std/toml";
import { computeLoopBody, FlowLoader, validateLoopBody } from "@exaix/flow";
import { BindingOverlaySchema, ConfigSchema, PlanSchema } from "@exaix/schemas";
import { OutputParser } from "@exaix/execution";

/** The gate fields the contract pins, with enum values compared as plain strings. */
interface IExpectedGate {
  agent_role: string;
  criteria: string[];
  threshold: number;
  onFail: string;
  maxRetries: number;
  includeRequestCriteria: boolean;
}

interface IGuardedRequestFrontmatter {
  flow: string;
  portal: string;
  plan_context_ref: string;
}

const FLOWS_DIR = "./Blueprints/Flows";
const OVERLAYS_DIR = "./configs/bindings/flows";
const SELF_CORRECTING = "self-correcting-implementation";

Deno.test("[contract] guarded validation carries a valid plan through the ReAct result description", async () => {
  const recording: { response: string } = JSON.parse(
    await Deno.readTextFile(
      "tests/scenario_framework/fixtures/mock_recordings/phase205/guarded/guarded-change-pass__submit__validate--react__0.json",
    ),
  );
  const result = new OutputParser().parseAgentResponse(recording.response, {
    trace_id: crypto.randomUUID(),
    request_id: "guarded-output",
    plan: "fallback",
  }, Date.now());
  const plan = PlanSchema.parse(JSON.parse(result.description));
  assertEquals(plan.subject, "Accepted guarded change");
  assertExists(plan.steps);
  assertEquals(plan.steps.map((step) => step.description), [
    "The confined proof and regression test are validated.",
  ]);
});

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

const TRIAGE = "triage-router";
const TRIAGE_TARGETS = ["bug-root-cause", "feature-design", "docs-draft", "security-review"];
const TRIAGE_TERMINALS = ["bug-fix-plan", "feature-plan", "docs-draft", "security-review"];

Deno.test("[contract] the shipped triage router parses with the planned branches, edges and transforms", async () => {
  const flow = await new FlowLoader(FLOWS_DIR).loadFlow(TRIAGE);
  const triage = flow.steps.find((step) => step.id === "triage")!;
  assertEquals([triage.type as string, triage.agent_role, triage.name], [
    "branch",
    "code-analyst",
    "Classify the request as bug, feature, docs or security",
  ]);
  assertEquals(triage.strategy, undefined);
  assertEquals(triage.effort, undefined);
  assertEquals(
    triage.branches?.map((branch) => [branch.condition, branch.goto]),
    ["bug", "feature", "docs", "security"].map((category, index) => [
      `results.triage.data.category === '${category}'`,
      TRIAGE_TARGETS[index],
    ]),
  );
  assertEquals(triage.default, "feature-design");
  assertEquals([triage.input.source as string, triage.input.transform as string], ["request", "passthrough"]);
  const edges = Object.fromEntries(
    flow.steps.filter((step) => step.id !== "triage").map((step) => [step.id, {
      role: step.agent_role,
      dependsOn: step.dependsOn,
      source: step.input.source as string,
      from: step.input.stepId ?? step.input.from,
      transform: step.input.transform as string,
    }]),
  );
  const fromStep = (role: string, stepId: string) => ({
    role,
    dependsOn: [stepId],
    source: "step",
    from: stepId,
    transform: "appendToRequest",
  });
  assertEquals(edges, {
    "bug-root-cause": fromStep("senior-coder", "triage"),
    "bug-fix-plan": fromStep("senior-coder", "bug-root-cause"),
    "feature-design": fromStep("software-architect", "triage"),
    "feature-plan": fromStep("software-architect", "feature-design"),
    "docs-draft": fromStep("technical-writer", "triage"),
    "security-review": fromStep("security-expert", "triage"),
    summary: {
      role: "technical-writer",
      dependsOn: TRIAGE_TERMINALS,
      source: "aggregate",
      from: TRIAGE_TERMINALS,
      transform: "appendToRequest",
    },
  });
  assertEquals(flow.namespace?.enabled, false);
  assertEquals([flow.settings.maxParallelism, flow.settings.failFast, flow.settings.timeout], [1, true, 300000]);
  assertEquals([flow.output.from, flow.output.format as string], ["summary", "markdown"]);
});

Deno.test("[contract] the triage overlay binds only the classifier to the strong service", async () => {
  const raw = parseToml(await Deno.readTextFile(`${OVERLAYS_DIR}/${TRIAGE}.example.toml`));
  const overlay = BindingOverlaySchema.parse(raw);
  assertEquals(
    Object.entries(overlay.bindings ?? {}).map(([selector, binding]) => [selector, binding.service, binding.effort]),
    [[`flow:${TRIAGE}/step:triage`, "strong-service", "high"]],
  );
});

const RESEARCH = "parallel-research";
const EXPLORERS = ["explore-code", "explore-docs", "explore-tests"];

Deno.test("[contract] parallel research declares the bounded explore group, namespace and warning gate", async () => {
  const flow = await new FlowLoader(FLOWS_DIR).loadFlow(RESEARCH);
  assertEquals([flow.namespace?.enabled, flow.namespace?.format as string, flow.namespace?.maxBytes], [
    true,
    "markdown",
    65536,
  ]);
  assertEquals([flow.settings.maxParallelism, flow.settings.failFast, flow.settings.timeout], [3, true, 300000]);
  assertEquals([flow.output.from, flow.output.format as string], ["compose", "markdown"]);
  for (const id of EXPLORERS) {
    const step = flow.steps.find((entry) => entry.id === id)!;
    assertEquals(step.dependsOn, []);
    assertEquals([step.input.source as string, step.input.transform as string], ["request", "passthrough"]);
    assertEquals(step.parallel, { group: "explore", mergeMode: "ordered", timeout_ms: 60000, continue_on_error: true });
    assertEquals(step.namespace?.writes, [{ key: `findings.${id.replace("explore-", "")}`, mode: "write" }]);
  }
  const code = flow.steps.find((entry) => entry.id === "explore-code")!;
  assertEquals(code.execution_mode as string, "dynamic");
  assertEquals(code.permitted_tools, ["read_file", "list_directory", "search_files"]);
  const compose = flow.steps.find((entry) => entry.id === "compose")!;
  assertEquals([compose.agent_role, compose.effort, compose.dependsOn], ["software-architect", "high", EXPLORERS]);
  assertEquals([compose.input.source as string, compose.input.transform as string], ["request", "passthrough"]);
  assertEquals(
    compose.namespace?.reads,
    ["code", "docs", "tests"].map((area) => ({ key: `findings.${area}`, required: false })),
  );
  const gate = flow.steps.find((entry) => entry.id === "evidence-gate")!;
  assertEquals([gate.type as string, gate.dependsOn, gate.input.source as string, gate.input.stepId], [
    "gate",
    ["compose"],
    "step",
    "compose",
  ]);
  assertEquals(gate.evaluate as IExpectedGate | undefined, {
    agent_role: "quality-judge",
    criteria: ["task_fulfillment", "code_correctness"],
    threshold: 0.8,
    onFail: "continue-with-warning",
    maxRetries: 3,
    includeRequestCriteria: false,
  });
});

Deno.test("[contract] the research overlay keeps explorers light and the composer and gate strong", async () => {
  const raw = parseToml(await Deno.readTextFile(`${OVERLAYS_DIR}/${RESEARCH}.example.toml`));
  const overlay = BindingOverlaySchema.parse(raw);
  const services = Object.fromEntries(
    Object.entries(overlay.bindings ?? {}).map(([selector, binding]) => [selector, binding.service]),
  );
  const step = (id: string) => `flow:${RESEARCH}/step:${id}`;
  assertEquals(services, {
    [step("explore-code")]: "light-service",
    [step("explore-docs")]: "light-service",
    [step("explore-tests")]: "light-service",
    [step("compose")]: "strong-service",
    [step("evidence-gate")]: "strong-service",
  });
});

Deno.test("[contract] guarded change binds hardened implementation review and a terminal security gate", async () => {
  const flow = await new FlowLoader(FLOWS_DIR).loadFlow("guarded-change");
  assertEquals<unknown>(flow.steps.map((step) => [step.id, step.type as string, step.dependsOn, step.input]), [
    ["explore", "agent", [], { source: "request", transform: "passthrough" }],
    ["implement", "session_delegate_cycle", ["explore"], {
      source: "step",
      stepId: "explore",
      transform: "passthrough",
    }],
    ["security-gate", "gate", ["implement"], {
      source: "aggregate",
      from: ["explore", "implement"],
      transform: "passthrough",
    }],
    ["validate", "agent", ["security-gate"], {
      source: "aggregate",
      from: ["implement", "security-gate"],
      transform: "passthrough",
    }],
  ]);
  const [explore, implement, security, validate] = flow.steps;
  assertEquals(explore.execution_mode as string, "dynamic");
  assertEquals(explore.permitted_tools, ["read_file", "list_directory", "search_files"]);
  assertEquals(implement.agent_role, "dogfood-coder");
  assertEquals<unknown>(implement.delegateCycle, {
    requireChangedPaths: true,
    review: {
      agent_role: "quality-judge",
      criteria: ["code_correctness", "has_tests", "task_fulfillment"],
      threshold: 0.8,
      onFail: "halt",
      maxRetries: 2,
      includeRequestCriteria: false,
    },
  });
  assertEquals(security.agent_role, "security-expert");
  assertEquals<unknown>(security.evaluate?.criteria, [
    {
      name: "path_confinement",
      category: "security",
      description: "Every changed path is src/proof.txt or tests/proof_test.ts in the resolved worktree.",
      required: true,
      weight: 1,
    },
    {
      name: "no_secret_exposure",
      category: "security",
      description: "The diff and return evidence contain no credentials, tokens or host secrets.",
      required: true,
      weight: 1,
    },
  ]);
  assertEquals([
    security.evaluate?.threshold,
    security.evaluate?.onFail,
    security.evaluate?.maxRetries,
    security.evaluate?.includeRequestCriteria,
  ], [0.8, "halt", 1, false]);
  assertEquals([validate.agent_role, validate.strategy as string], ["qa-engineer", "react"]);
  assertEquals(flow.namespace?.enabled, false);
  assertEquals([flow.settings.maxParallelism, flow.settings.failFast, flow.settings.timeout], [1, true, 600000]);
  assertEquals([flow.output.from, flow.output.format as string], ["validate", "markdown"]);
  const overlay = BindingOverlaySchema.parse(
    parseToml(await Deno.readTextFile(`${OVERLAYS_DIR}/guarded-change.example.toml`)),
  );
  assertEquals(
    Object.keys(overlay.bindings ?? {}).sort(),
    ["explore", "implement", "security-gate", "validate"].map((id) => `flow:guarded-change/step:${id}`).sort(),
  );
});

Deno.test("[contract] guarded requests activate the hardened coordinator and retain the plan pointer", async () => {
  const config = ConfigSchema.parse(
    parseToml(await Deno.readTextFile("tests/scenario_framework/fixtures/configs/phase205-guarded-change.toml")),
  );
  assertEquals(config.session_delegate?.enabled, true);
  assertEquals(config.session_delegate?.tool, "codex");
  assertEquals(config.session_delegate?.gates, ["code_changes"]);
  assertEquals(config.session_delegate?.launch_mode, "headless");
  assertEquals(config.session_delegate?.harden_permissions, true);
  assertEquals(config.session_delegate?.permitted_paths, ["src/proof.txt", "tests/proof_test.ts"]);
  for (const file of ["guarded_change", "guarded_change_pass"]) {
    const request = await Deno.readTextFile(`tests/scenario_framework/fixtures/requests/flow_blueprints/${file}.md`);
    const frontmatter = parseYaml(request.split("---")[1]) as IGuardedRequestFrontmatter;
    assertEquals(frontmatter.flow, "guarded-change");
    assertEquals(frontmatter.portal, "exaix-self");
    assertEquals(frontmatter.plan_context_ref, ".exa/PlanContext/phase205-guarded-change.md");
  }
});
