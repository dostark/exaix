/**
 * @module TrajectoryScenarioTest
 * @path tests/scenario_framework/tests/unit/trajectory_scenario_test.ts
 * @description Ensures the trajectory-assert scenario YAMLs parse without schema violations,
 * expose the expected fields, and expect only tools Exaix actually has.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { McpToolName, ToolName } from "@exaix/core";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import { ScenarioStepType } from "../../schema/step_schema.ts";
import { loadScenarioCatalog } from "../../runner/scenario_catalog.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const FRAMEWORK_HOME = join(REPO_ROOT, "tests/scenario_framework");
const SCENARIOS_DIR = join(FRAMEWORK_HOME, "scenarios/dynamic_execution");
const KNOWN_TOOLS = new Set<string>([...Object.values(ToolName), ...Object.values(McpToolName)]);

Deno.test("[TrajectoryScenario] trajectory-explore-assert declares order and argument checks on real tools", () => {
  const raw = Deno.readTextFileSync(join(SCENARIOS_DIR, "trajectory-explore-assert.yaml"));
  const scenario = ScenarioSchema.parse(parseYaml(raw));
  assertEquals(scenario.id, "trajectory-explore-assert");

  const order = scenario.steps.find((s) => s.id === "assert-trajectory-order");
  assertEquals(order?.type, ScenarioStepType.TRAJECTORY_ASSERT);
  // The trajectory comes from source_step's journal window. A name that points at nothing
  // gives an empty window and a silent 0.00, not an error.
  assert(scenario.steps.some((s) => s.id === order?.source_step), `source_step "${order?.source_step}" names no step`);
  assertEquals(order?.expected_sequence?.map((e) => e.tool), ["list_directory", "read_file"]);
  assertEquals(order?.order_matters, true);

  const args = scenario.steps.find((s) => s.id === "assert-read-args");
  assertEquals(args?.type, ScenarioStepType.TRAJECTORY_ASSERT);
  assertEquals(args?.expected_sequence?.[0].tool, "read_file");
  assertEquals(args?.expected_sequence?.[0].min_args, 1);
});

Deno.test("[TrajectoryScenario] every trajectory-assert step in the catalog expects only real Exaix tools", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const unknown: string[] = [];
  for (const scenario of catalog) {
    for (const step of scenario.steps) {
      if (step.type !== ScenarioStepType.TRAJECTORY_ASSERT) continue;
      for (const entry of step.expected_sequence ?? []) {
        if (!KNOWN_TOOLS.has(entry.tool)) unknown.push(`${scenario.id}/${step.id}: ${entry.tool}`);
      }
    }
  }
  assertEquals(unknown, [], "a trajectory expecting a tool Exaix does not have can never pass");
});
