/**
 * @module DelegateMatrixScenarioFixture
 * @path tests/scenario_framework/tests/unit/helpers/delegate_matrix_scenario_fixture.ts
 * @description Shared YAML parsing for the delegate matrix and hardening scenario tests.
 * @architectural-layer Testing
 * @related-files [tests/scenario_framework/tests/unit/delegate_matrix_scenario_test.ts, tests/scenario_framework/tests/unit/delegate_matrix_scenario_security_test.ts]
 */

import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { ScenarioSchema } from "../../../schema/scenario_schema.ts";

export const REPO_ROOT = fromFileUrl(new URL("../../../../../", import.meta.url));
export const MATRIX_SCENARIO = join(
  REPO_ROOT,
  "tests/scenario_framework/scenarios/provider_live/session_delegate_matrix_live.yaml",
);
export const HARDENING_SCENARIO = join(
  REPO_ROOT,
  "tests/scenario_framework/scenarios/provider_live/session_delegate_hardening_active_live.yaml",
);

export async function parseMatrixScenario(): Promise<ReturnType<typeof ScenarioSchema.parse>> {
  const raw = await Deno.readTextFile(MATRIX_SCENARIO);
  return ScenarioSchema.parse(parseYaml(raw));
}

export async function parseHardeningScenario(): Promise<ReturnType<typeof ScenarioSchema.parse>> {
  const raw = await Deno.readTextFile(HARDENING_SCENARIO);
  return ScenarioSchema.parse(parseYaml(raw));
}
