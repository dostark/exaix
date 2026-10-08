/**
 * @module CodexScopeViolationScenarioFixture
 * @path tests/scenario_framework/tests/unit/helpers/codex_scope_violation_fixture.ts
 * @description Shared loader for the Codex-specific negative scenario
 *   session_delegate_codex_scope_violation_live.yaml: resolves the repo root and parses
 *   the scenario against ScenarioSchema.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/codex_scope_violation_scenario_test.ts, tests/scenario_framework/tests/unit/codex_scope_violation_scenario_security_test.ts]
 */

import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { type IScenario, ScenarioSchema } from "../../../schema/scenario_schema.ts";

export const REPO_ROOT = fromFileUrl(new URL("../../../../../", import.meta.url));
const SCENARIO_PATH = join(
  REPO_ROOT,
  "tests/scenario_framework/scenarios/provider_live/session_delegate_codex_scope_violation_live.yaml",
);

export async function parseScenario(): Promise<IScenario> {
  const raw = await Deno.readTextFile(SCENARIO_PATH);
  return ScenarioSchema.parse(parseYaml(raw));
}
