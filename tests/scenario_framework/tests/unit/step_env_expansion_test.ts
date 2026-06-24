/**
 * @module ScenarioFrameworkStepEnvExpansionTest
 * @path tests/scenario_framework/tests/unit/step_env_expansion_test.ts
 * @description Phase 127 Step 5 (harness fix) — RED-first test for step.env variable expansion.
 *   The scenario runner expanded $VARS in command/args/criterion-paths but NOT in step.env
 *   values, so a setup-db step setting EXA_MIGRATIONS_DIR="$FRAMEWORK_HOME/../../migrations"
 *   was passed literally. expandVariablesInStep must also expand env values so the migrations
 *   override resolves to a real path.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts]
 */

import { assertEquals } from "@std/assert";
import { expandVariablesInStep } from "../../runner/synthetic_runner.ts";
import { ScenarioStepType } from "../../schema/step_schema.ts";
import type { IScenarioStep } from "../../schema/step_schema.ts";

Deno.test("[step_env] expandVariablesInStep expands $VARS in step.env values", () => {
  const step = {
    id: "setup-db",
    type: ScenarioStepType.SHELL,
    command: "deno",
    args: ["run", "$FRAMEWORK_HOME/../../scripts/setup_db.ts"],
    env: { EXA_MIGRATIONS_DIR: "$FRAMEWORK_HOME/../../migrations" },
    continue_on_failure: false,
    input_criteria: [],
    output_criteria: [],
  } as IScenarioStep;

  const resolved = expandVariablesInStep(step, { FRAMEWORK_HOME: "/repo/tests/scenario_framework" });

  assertEquals(
    resolved.env?.EXA_MIGRATIONS_DIR,
    "/repo/tests/scenario_framework/../../migrations",
    "step.env values must be expanded so EXA_MIGRATIONS_DIR resolves",
  );
  // args expansion must still work (regression).
  assertEquals(resolved.args?.[1], "/repo/tests/scenario_framework/../../scripts/setup_db.ts");
});

Deno.test("[step_env] a step without env is unaffected", () => {
  const step = {
    id: "plain",
    type: ScenarioStepType.EXACTL,
    command: "daemon",
    args: ["start"],
    continue_on_failure: false,
    input_criteria: [],
    output_criteria: [],
  } as IScenarioStep;
  const resolved = expandVariablesInStep(step, { FRAMEWORK_HOME: "/x" });
  assertEquals(resolved.env, undefined);
});
