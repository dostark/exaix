/**
 * @module ModelIntentE2EScenarioTest
 * @path tests/scenario_framework/tests/unit/model_intent_e2e_scenario_test.ts
 * @description Phase 132 GAP-8 remediation (132.25) — the provider-live scenario
 *   model_intent_e2e.yaml + its request fixture exist and are structurally valid
 *   (dry-run: the runner can load them without provider keys). The live execution
 *   (asserting a thinking-capable M-profile resolution on journaled model.resolved)
 *   runs in the nightly provider-live tier with real API keys.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/provider_live/model_intent_e2e.yaml, tests/scenario_framework/fixtures/requests/provider_live/model_intent_e2e.md]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const SCENARIO_PATH = join(
  REPO_ROOT,
  "tests/scenario_framework/scenarios/provider_live/model_intent_e2e.yaml",
);
const FIXTURE_PATH = join(
  REPO_ROOT,
  "tests/scenario_framework/fixtures/requests/provider_live/model_intent_e2e.md",
);

Deno.test("model_intent_e2e scenario loads against the scenario schema (dry-run, no provider keys)", async () => {
  const content = await Deno.readTextFile(SCENARIO_PATH);
  const parsed = parseYaml(content);
  const scenario = ScenarioSchema.parse(parsed);

  assertEquals(scenario.id, "model-intent-e2e");
  assert(scenario.tags.includes("provider-live"), "scenario must be tagged provider-live");
  assert(scenario.request_fixture.endsWith("model_intent_e2e.md"));

  const stepIds = scenario.steps.map((step) => step.id);
  assertEquals(stepIds.includes("submit-request"), true);
  assertEquals(stepIds.includes("assert-model-resolved"), true);
});

// Only execution emits model.resolved. Approve and execute the plan before the assertion.
Deno.test("model_intent_e2e approves and executes the plan before asserting model.resolved", async () => {
  const scenario = ScenarioSchema.parse(parseYaml(await Deno.readTextFile(SCENARIO_PATH)));
  const stepIds = scenario.steps.map((step) => step.id);
  const assertIndex = stepIds.indexOf("assert-model-resolved");

  assert(stepIds.indexOf("approve-plan") !== -1, "scenario must approve the plan");
  assert(stepIds.indexOf("wait-for-execution") !== -1, "scenario must wait for execution");
  assert(stepIds.indexOf("approve-plan") < assertIndex);
  assert(stepIds.indexOf("wait-for-execution") < assertIndex);
});

Deno.test("model_intent_e2e executes against a disposable portal, never the repository root", async () => {
  const scenario = ScenarioSchema.parse(parseYaml(await Deno.readTextFile(SCENARIO_PATH)));

  for (const portal of scenario.portals) {
    assert(!portal.source_path.includes("$REPO_ROOT"), `portal ${portal.alias} must not mount the repository root`);
    assert(
      portal.target_path?.startsWith("$WORKSPACE_ROOT/"),
      `portal ${portal.alias} must be copied into the sandbox`,
    );
  }
});

Deno.test("model_intent_e2e request fixture declares the M-profile thinking intent", async () => {
  const content = await Deno.readTextFile(FIXTURE_PATH);
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  assert(match !== null, "fixture must carry YAML frontmatter");
  const frontmatter = parseYaml(match[1]) as { model_size?: string; thinking?: boolean };

  assertEquals(frontmatter.model_size, "M");
  assertEquals(frontmatter.thinking, true);
});
