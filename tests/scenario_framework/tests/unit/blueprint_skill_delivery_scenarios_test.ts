/**
 * @module BlueprintSkillDeliveryScenariosTest
 * @path tests/scenario_framework/tests/unit/blueprint_skill_delivery_scenarios_test.ts
 * @description Executes the declared deterministic delivery scenario commands with their actual request fixtures.
 * @architectural-layer Test
 * @related-files [tests/integration/blueprint_skill_delivery_test.ts, tests/scenario_framework/schema/scenario_schema.ts]
 */
import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parse } from "@std/yaml";
import { REPO_ROOT } from "@exaix/testing";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";

const FRAMEWORK = join(REPO_ROOT, "tests", "scenario_framework");
for (
  const path of [
    "flow_blueprints/implementation-plan-delivery.yaml",
    "skill_eval/blueprint-authoring-delivery.yaml",
  ]
) {
  Deno.test(`delivery scenario executes without live models: ${path}`, async () => {
    const scenario = ScenarioSchema.parse(parse(await Deno.readTextFile(join(FRAMEWORK, "scenarios", path))));
    const request = join(FRAMEWORK, scenario.request_fixture);
    await Deno.stat(request);
    const step = scenario.steps[0];
    assertEquals(step.type, "run-script");
    assertEquals(step.command, "deno");
    assertExists(step.args);
    const args = step.args.map((arg) =>
      arg.replaceAll("$REPO_ROOT", REPO_ROOT).replaceAll("$REQUEST_FIXTURE", request)
    );
    const output = await new Deno.Command(Deno.execPath(), {
      args,
      env: { NO_COLOR: "1" },
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout((step.timeout_sec ?? 120) * 1000),
    }).output();
    const text = new TextDecoder().decode(output.stdout) + new TextDecoder().decode(output.stderr);
    assertEquals(output.code, 0, text);
    assertStringIncludes(text, "ok | 1 passed | 0 failed");
  });
}
