/**
 * @module FixtureBoundScenarioCiExclusionTest
 * @path tests/scenario_framework/tests/unit/fixture_bound_scenario_ci_exclusion_test.ts
 * @description RED-first regression test. A scenario whose matrix cell boots the daemon on a
 *   config carrying the `__COMPAT_FIXTURE_PORT__` sentinel needs the local compatible HTTP
 *   fixture, which the standalone runner (`eval run`, `eval:subsystems`) cannot provision.
 *   Every such scenario must therefore be excluded from the CI-safe catalog by a
 *   `CI_EXCLUDED_TAGS` member (the `agent_flows` convention is `manual-only`), so a generic
 *   runner skips it instead of crashing with `unknown_model` or
 *   `Compatible fixture preset requires compatFixturePort`. Three Phase 203 scenarios
 *   (`operator-override-axes`, `scenario-bindings-split`, `flow-step-model-bindings`) omitted
 *   that tag and turned `eval:subsystems` red.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scenario_catalog.ts, tests/scenario_framework/runner/sentinels.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { listCiSafeScenarios, loadScenarioCatalog } from "../../runner/scenario_catalog.ts";
import { SENTINEL_COMPAT_FIXTURE_PORT } from "../../runner/sentinels.ts";

const TEST_FILE_DIR = dirname(fromFileUrl(import.meta.url));
const FRAMEWORK_HOME = join(TEST_FILE_DIR, "../..");
const REPO_ROOT = resolve(TEST_FILE_DIR, "../../../..");

/** Scenario ids whose inline matrix cells boot the loopback compatible fixture. */
async function fixtureBoundScenarioIds(): Promise<string[]> {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const ids: string[] = [];
  for (const scenario of catalog) {
    for (const cell of scenario.matrix?.cells ?? []) {
      let text: string;
      try {
        text = await Deno.readTextFile(resolve(REPO_ROOT, cell.config));
      } catch {
        continue;
      }
      if (text.includes(SENTINEL_COMPAT_FIXTURE_PORT)) {
        ids.push(scenario.id);
        break;
      }
    }
  }
  return ids.sort();
}

Deno.test("[FixtureBoundScenarioCiExclusion] the probe finds the known fixture-bound scenarios", async () => {
  const ids = await fixtureBoundScenarioIds();
  assert(
    ids.includes("operator-override-axes") &&
      ids.includes("scenario-bindings-split") &&
      ids.includes("flow-step-model-bindings"),
    `probe must find the known Phase 203 fixture-bound scenarios, found: ${ids.join(", ")}`,
  );
});

Deno.test("[FixtureBoundScenarioCiExclusion] every fixture-bound scenario is excluded from the CI-safe catalog", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const ciSafeIds = new Set(listCiSafeScenarios(catalog).map((scenario) => scenario.id));
  const leaked = (await fixtureBoundScenarioIds()).filter((id) => ciSafeIds.has(id));

  assertEquals(
    leaked,
    [],
    `scenario(s) ${leaked.join(", ")} boot the loopback fixture but are selectable by a generic ` +
      "CI profile, which cannot provision it — tag them with a CI_EXCLUDED_TAGS member " +
      "(the agent_flows convention is 'manual-only')",
  );
});
