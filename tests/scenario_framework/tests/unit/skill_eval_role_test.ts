/**
 * @module SkillEvalRoleTest
 * @path tests/scenario_framework/tests/unit/skill_eval_role_test.ts
 * @description Validates the selected role blueprints for the skill evaluation cases.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/scenario_schema.ts]
 */
import {
  assert,
  assertArrayIncludes,
  assertEquals,
  assertExists,
  assertNotMatch,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { parse } from "@std/yaml";
import { parse as parseToml } from "@std/toml";
import { REPO_ROOT } from "@exaix/testing";
import { ConfigSchema } from "@exaix/schemas";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";

Deno.test("skill evaluation requests select existing agent role blueprints", async () => {
  for (const group of [1, 2, 3, 4, 5]) {
    for (const index of [1, 2, 3, 4, 5]) {
      const id = `p234-s${group}-c${index}`;
      const path = join(REPO_ROOT, `tests/scenario_framework/scenarios/skill_eval/${id}.yaml`);
      const scenario = ScenarioSchema.parse(parse(await Deno.readTextFile(path)));
      for (const step of scenario.steps.filter((item) => item.command === "request")) {
        const position = step.args?.indexOf("--agent-role") ?? -1;
        const role = position < 0 ? undefined : step.args?.[position + 1];
        assertExists(role, `${id} must choose an agent role`);
        await Deno.stat(join(REPO_ROOT, "Blueprints/Agents", `${role}.md`));
      }
    }
  }
});

Deno.test("failed skill evaluation cases select Codex Terra with high effort", async () => {
  const preset = parseToml(await Deno.readTextFile(join(REPO_ROOT, "configs/claude-sonnet-4-6-skill-eval.toml")));
  assertEquals(preset.ai, { provider: "claude-cli", model: "claude-sonnet-4-6" });
  const codex = parseToml(await Deno.readTextFile(join(REPO_ROOT, "configs/codex-terra-61-skill-eval.toml")));
  assertEquals(codex.ai, { provider: "codex-cli", model: "gpt-6.1-terra" });
  assertEquals(ConfigSchema.safeParse(codex).success, true);
  for (const group of [1, 2, 3, 4, 5, 6]) {
    for (const index of [1, 2, 3, 4, 5]) {
      const id = `p234-s${group}-c${index}`;
      const path = join(REPO_ROOT, `tests/scenario_framework/scenarios/skill_eval/${id}.yaml`);
      const scenario = ScenarioSchema.parse(parse(await Deno.readTextFile(path)));
      const text = JSON.stringify(scenario);
      assertNotMatch(text, /deepseek|ollama|openai-chat/i);
      const rerun = group === 5 || group === 6 || (group === 2 && [2, 4].includes(index)) ||
        (group === 4 && index === 4) ||
        (group === 3 && [1, 2, 4].includes(index));
      if (rerun) {
        for (const step of scenario.steps.filter((item) => item.command === "request")) {
          const effort = step.args?.indexOf("--effort") ?? -1;
          assertEquals(step.args?.[effort + 1], "high", id);
        }
      }
      if ([2, 4, 5].includes(group)) {
        assertStringIncludes(
          text,
          rerun ? "configs/codex-terra-61-skill-eval.toml" : "configs/claude-sonnet-4-6-skill-eval.toml",
        );
      }
    }
  }
});

Deno.test("development skill evaluations prepare isolated dogfood roots", async () => {
  for (const group of [1, 3]) {
    for (const index of [1, 2, 3, 4, 5]) {
      const id = `p234-s${group}-c${index}`;
      const path = join(REPO_ROOT, `tests/scenario_framework/scenarios/skill_eval/${id}.yaml`);
      const scenario = ScenarioSchema.parse(parse(await Deno.readTextFile(path)));
      const prep = scenario.steps.find((step) => step.id === "prepare-dogfood-workspace");
      assertExists(prep, `${id} must prepare the dogfood workspace`);
      assert(prep.args?.includes(id));
      assert(prep.args?.some((arg) => arg.endsWith("/runner/planning_workspace.ts")));
      const start = scenario.steps.findIndex((step) => step.id === "start-daemon");
      assert(scenario.steps.indexOf(prep) < start);
    }
  }
});

Deno.test("planning cases declare isolated preparation and request-bound record checks", async () => {
  for (const index of [1, 2, 3, 4, 5]) {
    const id = `p234-s6-c${index}`;
    const path = join(REPO_ROOT, `tests/scenario_framework/scenarios/skill_eval/${id}.yaml`);
    const scenario = ScenarioSchema.parse(parse(await Deno.readTextFile(path)));
    assertArrayIncludes(scenario.tags, ["provider-live"]);
    const prep = scenario.steps.find((step) => step.id === "prepare-dogfood-workspace");
    const check = scenario.steps.find((step) => step.id === "check-planning-record");
    assertExists(prep);
    assertExists(check);
    assert(prep.args?.includes(id));
    assert(check.args?.includes(id));
    assert(check.args?.includes("$REQUEST_ID"));
    assert(check.args?.some((arg) => arg.endsWith("/runner/planning_decisions_check.ts")));
  }
});

Deno.test("requirements and planning cases snapshot the portal before request submission", async () => {
  for (const group of [5, 6]) {
    for (const index of [1, 2, 3, 4, 5]) {
      const id = `p234-s${group}-c${index}`;
      const path = join(REPO_ROOT, `tests/scenario_framework/scenarios/skill_eval/${id}.yaml`);
      const scenario = ScenarioSchema.parse(parse(await Deno.readTextFile(path)));
      const baseline = scenario.steps.findIndex((step) => step.id === "capture-workspace-baseline");
      const submit = scenario.steps.findIndex((step) => step.id === "submit-request");
      assert(baseline >= 0 && baseline < submit, `${id} must capture a baseline before submission`);
      assert(scenario.steps[baseline].args?.includes(id));
    }
  }
});

Deno.test("diagnosis and verification cases bind diagnostic and evidence checks to their request", async () => {
  for (const group of [1, 2, 3, 4]) {
    for (const index of [1, 2, 3, 4, 5]) {
      const id = `p234-s${group}-c${index}`;
      const path = join(REPO_ROOT, `tests/scenario_framework/scenarios/skill_eval/${id}.yaml`);
      const scenario = ScenarioSchema.parse(parse(await Deno.readTextFile(path)));
      const baseline = scenario.steps.findIndex((step) => step.id === "capture-workspace-baseline");
      const submit = scenario.steps.findIndex((step) => step.id === "submit-request");
      const diagnostic = scenario.steps.find((step) => step.id.startsWith("assert-"));
      const gate = scenario.steps.find((step) => step.id === "evaluate-evidence");
      assert(baseline >= 0 && baseline < submit, id);
      assertExists(diagnostic);
      assert(diagnostic.args?.includes("$REQUEST_ID"));
      assert(diagnostic.args?.includes("diagnostic"));
      assertExists(gate);
      assert(gate.args?.includes("$REQUEST_ID"));
      assert(scenario.steps.indexOf(gate) > scenario.steps.findIndex((step) => step.id === "stop-daemon"));
    }
  }
});

Deno.test("the two-caller case uses the approved corrected race fixture", async () => {
  const path = join(REPO_ROOT, "tests/scenario_framework/scenarios/skill_eval/p234-s2-c2.yaml");
  const scenario = ScenarioSchema.parse(parse(await Deno.readTextFile(path)));
  assertEquals(scenario.portals[0].source_path, "$FRAMEWORK_HOME/fixtures/portals/p234_s2_c2_corrected");
});

Deno.test("requirements scenarios collect diagnostic records before the separate evidence gate", async () => {
  for (const index of [1, 2, 3, 4, 5]) {
    const id = `p234-s5-c${index}`;
    const path = join(REPO_ROOT, `tests/scenario_framework/scenarios/skill_eval/${id}.yaml`);
    const scenario = ScenarioSchema.parse(parse(await Deno.readTextFile(path)));
    const initial = scenario.steps.find((step) => step.id === "assert-plan");
    const gate = scenario.steps.find((step) => step.id === "evaluate-evidence");
    assertExists(initial);
    assertExists(gate);
    assert(initial.args?.includes("diagnostic"));
    assert(gate.args?.includes("evaluate"));
    assert(scenario.steps.indexOf(gate) > scenario.steps.indexOf(initial));
    const stop = scenario.steps.findIndex((step) => step.id === "stop-daemon");
    assert(stop >= 0 && scenario.steps.indexOf(gate) > stop, `${id} must stop the daemon before the evidence gate`);
    if (index === 2) {
      const answer = scenario.steps.find((step) => step.id === "assert-answer");
      assertExists(answer);
      assert(answer.args?.includes("diagnostic"));
      assert(scenario.steps.indexOf(gate) > scenario.steps.indexOf(answer));
    }
  }
});
