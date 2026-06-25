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

Deno.test("[step_env] a longer var is not corrupted by a shorter prefix var (no $EXA_CONFIG-into-$EXA_CONFIG_PATH bleed)", () => {
  const step = {
    id: "start-daemon",
    type: ScenarioStepType.EXACTL,
    command: "daemon",
    args: ["start"],
    // $EXA_CONFIG is a prefix of $EXA_CONFIG_PATH; iterate-and-replaceAll would corrupt the
    // longer name to "/short_PATH" if the shorter key is processed first. A correct single-pass
    // expansion must substitute each $VAR by its full name only.
    env: { CFG: "$EXA_CONFIG_PATH", SHORT: "$EXA_CONFIG" },
    continue_on_failure: false,
    input_criteria: [],
    output_criteria: [],
  } as IScenarioStep;

  const resolved = expandVariablesInStep(step, {
    EXA_CONFIG: "/short",
    EXA_CONFIG_PATH: "/full/path",
  });

  assertEquals(resolved.env?.CFG, "/full/path", "$EXA_CONFIG_PATH must expand to its own value, not /short_PATH");
  assertEquals(resolved.env?.SHORT, "/short");
});

Deno.test("[step_env] an unknown $VAR is left untouched (not blanked)", () => {
  const step = {
    id: "plain",
    type: ScenarioStepType.SHELL,
    command: "echo",
    args: ["$NOT_A_DEFINED_VAR/x"],
    continue_on_failure: false,
    input_criteria: [],
    output_criteria: [],
  } as IScenarioStep;
  const resolved = expandVariablesInStep(step, { FRAMEWORK_HOME: "/x" });
  assertEquals(resolved.args?.[0], "$NOT_A_DEFINED_VAR/x", "unknown vars must be preserved verbatim");
});
