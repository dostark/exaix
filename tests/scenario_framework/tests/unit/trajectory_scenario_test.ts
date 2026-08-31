/**
 * @module TrajectoryScenarioTest
 * @path tests/scenario_framework/tests/unit/trajectory_scenario_test.ts
 * @description Ensures the trajectory-assert scenario YAMLs parse without
 * schema violations and expose all expected fields.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import { ScenarioStepType } from "../../schema/step_schema.ts";
import { loadScenarioCatalog } from "../../runner/scenario_catalog.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const SCENARIOS_DIR = join(REPO_ROOT, "tests/scenario_framework/scenarios/dynamic_execution");

Deno.test("[TrajectoryScenario] trajectory-tool-order-assert parses with correct fields", () => {
  const path = join(SCENARIOS_DIR, "trajectory-tool-order-assert.yaml");
  const raw = Deno.readTextFileSync(path);
  const scenario = ScenarioSchema.parse(parseYaml(raw));

  assertEquals(scenario.id, "trajectory-tool-order-assert");
  assertEquals(scenario.pack, "dynamic_execution");

  const assertStep = scenario.steps.find((s) => s.id === "assert-trajectory-order");
  assertEquals(assertStep?.type, ScenarioStepType.TRAJECTORY_ASSERT);
  // `source_step` must resolve to a step the scenario declares — the trajectory is read from
  // that step's journal window, so a name pointing at nothing yields an empty window and a
  // silent 0.00 rather than an error.
  assertEquals(
    scenario.steps.some((s) => s.id === assertStep?.source_step),
    true,
    `source_step "${assertStep?.source_step}" names no declared step`,
  );
  assertEquals(assertStep?.expected_sequence?.length, 3);
  assertEquals(assertStep?.expected_sequence?.[0].tool, "read_file");
  assertEquals(assertStep?.expected_sequence?.[1].tool, "edit_file");
  assertEquals(assertStep?.expected_sequence?.[2].tool, "bash");
  assertEquals(assertStep?.order_matters, true);
  assertEquals(assertStep?.allow_extra_tools, false);
  assertEquals(assertStep?.partial_credit, false);
});

Deno.test("[TrajectoryScenario] trajectory-tool-args-assert parses with args constraints", () => {
  const path = join(SCENARIOS_DIR, "trajectory-tool-args-assert.yaml");
  const raw = Deno.readTextFileSync(path);
  const scenario = ScenarioSchema.parse(parseYaml(raw));

  assertEquals(scenario.id, "trajectory-tool-args-assert");
  const assertStep = scenario.steps.find((s) => s.id === "assert-args-constraints");
  assertEquals(assertStep?.type, ScenarioStepType.TRAJECTORY_ASSERT);
  assertEquals(
    scenario.steps.some((s) => s.id === assertStep?.source_step),
    true,
    `source_step "${assertStep?.source_step}" names no declared step`,
  );
  assertEquals(assertStep?.expected_sequence?.length, 2);

  const search = assertStep?.expected_sequence?.[0];
  assertEquals(search?.tool, "search_code");
  assertEquals(search?.args_contains, ["foo", "/src"]);
  assertEquals(search?.min_args, 3);
  assertEquals(search?.max_args, 3);

  const read = assertStep?.expected_sequence?.[1];
  assertEquals(read?.tool, "read_file");
  assertEquals(read?.args_contains, ["bar.py"]);
  assertEquals(read?.min_args, 1);
  assertEquals(read?.max_args, 2);
});

Deno.test("[TrajectoryScenario] all trajectory scenarios are discoverable by catalog", async () => {
  const FRAMEWORK_HOME = join(REPO_ROOT, "tests/scenario_framework");
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const trajectoryScenarios = catalog.filter((s: { id: string }) => s.id.startsWith("trajectory-"));
  assertEquals(trajectoryScenarios.length >= 2, true);
});
