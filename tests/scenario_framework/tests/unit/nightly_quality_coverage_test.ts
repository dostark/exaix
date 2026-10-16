/**
 * @module NightlyQualityCoverageTest
 * @path tests/scenario_framework/tests/unit/nightly_quality_coverage_test.ts
 * @description Checks runnable role, skill, and shipped-flow quality coverage.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scenario_catalog.ts, tests/scenario_framework/schema/scenario_schema.ts]
 */
import { ConfigService } from "@exaix/core/config";
import { loadBindingLayers, resolveBinding } from "@exaix/ai";
import { assert, assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { loadScenarioCatalog } from "../../runner/scenario_catalog.ts";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import type { IScenario } from "../../schema/scenario_schema.ts";

const FRAMEWORK_HOME = resolve(import.meta.dirname!, "../..");
const REPO_ROOT = resolve(FRAMEWORK_HOME, "../..");
const QUALITY_SKILLS = ["tdd-methodology", "security-first", "code-review", "typescript-patterns", "portal-grounding"];
const QUALITY_FLOWS = ["pr-review", "bug-investigation", "api-documentation"];

async function readScenario(path: string): Promise<IScenario> {
  return ScenarioSchema.parse(parseYaml(await Deno.readTextFile(resolve(FRAMEWORK_HOME, path))));
}

function assertJudge(scenario: IScenario): void {
  const judges = scenario.steps.filter((step) => step.output_criteria.some((c) => c.kind === "llm-judge"));
  assert(judges.length > 0, `${scenario.id} needs a real quality criterion`);
  for (const step of judges) {
    assertEquals(step.output_criteria.length, 1, `${scenario.id} must not dilute its quality score`);
    assertEquals(step.step_pass_threshold, 0.7);
  }
  assertEquals(scenario.bindings?.judge?.service, "claude-cli");
}

Deno.test("nightly quality: every production role smoke has an opt-in judged plan cell", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const roles = catalog.filter((entry) => entry.pack === "agent_role_eval");
  assertEquals(roles.length, 14);
  for (const entry of roles) {
    const scenario = await readScenario(entry.scenario_path);
    const live = scenario.matrix?.cells?.find((cell) => cell.tool === "live");
    assert(live, `${scenario.id} has no live plan cell`);
    assertEquals(live.requires_optin, "EXA_MATRIX_AGENT_ROLE_LIVE");
    assertJudge(scenario);
    const role = scenario.tags.find((tag) => tag.startsWith("entity:"))!.slice("entity:".length);
    const attribution = scenario.steps.filter((step) => step.cells?.includes("live"))
      .flatMap((step) => step.output_criteria).find((criterion) =>
        criterion.kind === "frontmatter-field-equals" && criterion.field === "agent_role"
      );
    assert(attribution?.kind === "frontmatter-field-equals", `${scenario.id} needs live role attribution`);
    assertEquals(attribution.equals, role);
    await Deno.stat(resolve(REPO_ROOT, "Blueprints/Agents", `${role}.md`));
  }
});

Deno.test("nightly quality: five current skills prove injection and judge plan effectiveness", async () => {
  for (const skill of QUALITY_SKILLS) {
    const scenario = await readScenario(`scenarios/skill_eval/effectiveness-${skill}.yaml`);
    assert(scenario.tags.includes("provider-live"));
    assert(scenario.tags.includes(`entity:${skill}`));
    assertJudge(scenario);
    const injection = scenario.steps.flatMap((step) => step.output_criteria).find((criterion) =>
      criterion.kind === "journal-event-exists" && criterion.event_type === "skills.resolved"
    );
    assert(injection?.kind === "journal-event-exists");
    assertEquals(injection.payload_includes?.pinned_skill_ids, [skill]);
    const root = skill === "portal-grounding" ? "Memory/Skills/project/Exaix" : "Blueprints/Skills";
    await Deno.stat(resolve(REPO_ROOT, root, skill, "SKILL.md"));
    if (skill === "portal-grounding") assert(scenario.portals.some((portal) => portal.alias === "Exaix"));
  }
});

Deno.test("nightly quality: representative shipped flows have judged artifact variants", async () => {
  for (const flow of QUALITY_FLOWS) {
    const scenario = await readScenario(`scenarios/flow_blueprints/quality-${flow}.yaml`);
    assert(scenario.tags.includes("provider-live"));
    assert(scenario.tags.includes(`entity:${flow}.flow`));
    assertEquals(scenario.flow_fixture, undefined, "quality runs must execute the shipped blueprint");
    assertJudge(scenario);
    const request = await Deno.readTextFile(resolve(FRAMEWORK_HOME, scenario.request_fixture!));
    assert(request.includes(`flow: ${flow}`));
    await Deno.stat(resolve(REPO_ROOT, "Blueprints/Flows", `${flow}.flow.yaml`));
  }
});

Deno.test("nightly quality: shipped flow steps bind to the qualified DeepSeek service", async () => {
  const config = new ConfigService(resolve(REPO_ROOT, "configs/subsystem-live.toml")).get();
  assertEquals(config.ai?.timeout_ms, 180000, "bound API calls need the live planning timeout");
  const layers = await loadBindingLayers(config);
  const ref = {
    flowId: "api-documentation",
    stepId: "code-analysis",
    agentRole: "code-analyst",
    kind: "agent" as const,
    nativeTools: false,
  };
  const outcome = resolveBinding(ref, { binding: {} }, layers, {
    hasKey: (key) => key === "DEEPSEEK_API_KEY",
    hasOptIn: () => false,
  });
  assertEquals(outcome.kind, "bound");
  if (outcome.kind === "bound") {
    assertEquals(outcome.binding.service, "deepseek");
    assertEquals(outcome.binding.model, "deepseek/deepseek-v4-pro");
  }
});

Deno.test("nightly quality: judge roles receive concrete evidence and comparison options", async () => {
  const judge = await readScenario("scenarios/agent_role_eval/quality-judge-smoke.yaml");
  const judgeRequest = await Deno.readTextFile(resolve(FRAMEWORK_HOME, judge.request_fixture!));
  assert(judgeRequest.includes("PortalPermissionsService.checkAgentAllowed"));
  assert(judgeRequest.includes('agentRolesAllowed.includes("*")'));
  const voting = await readScenario("scenarios/agent_role_eval/voting-judge-smoke.yaml");
  const votingRequest = await Deno.readTextFile(resolve(FRAMEWORK_HOME, voting.request_fixture!));
  for (const label of ["Approach A", "Approach B", "Approach C"]) assert(votingRequest.includes(label));
});

Deno.test("nightly quality: implementation-plan judges use the requested stage", async () => {
  for (const role of ["technical-writer", "test-engineer"]) {
    const scenario = await readScenario(`scenarios/agent_role_eval/${role}-smoke.yaml`);
    const criterion = scenario.steps.flatMap((step) => step.output_criteria).find((criterion) =>
      criterion.kind === "llm-judge"
    );
    assert(criterion?.kind === "llm-judge");
    assert(criterion.rubric?.includes("plan-only"), `${role} must grade the plan stage`);
  }
});
