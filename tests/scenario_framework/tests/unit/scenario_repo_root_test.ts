/**
 * @module ScenarioRepoRootTest
 * @path tests/scenario_framework/tests/unit/scenario_repo_root_test.ts
 * @description The scenario runner resolves repo-root assets (deno.json, scripts/setup_db.ts,
 *   migrations, configs) from EXA_SCENARIO_REPO_ROOT when a caller sets it, so a deployed
 *   framework outside the repo still finds them. Without the override it derives the root
 *   from its own location.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts, scripts/ci.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { withEnv } from "@exaix/testing";
import { resolveScenarioRepoRoot, SCENARIO_REPO_ROOT_ENV } from "../../runner/synthetic_runner.ts";

const CI_SOURCE = await Deno.readTextFile(new URL("../../../../scripts/ci.ts", import.meta.url));

Deno.test("[repo_root] resolveScenarioRepoRoot prefers EXA_SCENARIO_REPO_ROOT", async () => {
  await withEnv({ [SCENARIO_REPO_ROOT_ENV]: "/opt/exaix-checkout" }, () => {
    assertEquals(resolveScenarioRepoRoot("/tmp/deployed/framework/scenario_framework/runner"), "/opt/exaix-checkout");
  });
});

Deno.test("[repo_root] resolveScenarioRepoRoot derives the repo root from the runner location without the override", async () => {
  await withEnv({ [SCENARIO_REPO_ROOT_ENV]: null }, () => {
    const derived = resolveScenarioRepoRoot("/repo/tests/scenario_framework/runner");
    assertEquals(derived, "/repo");
  });
});

Deno.test("[repo_root] the scenarios command exports EXA_SCENARIO_REPO_ROOT so a deployed framework finds the repo", () => {
  const scenariosStart = CI_SOURCE.indexOf("const scenariosCommand");
  const scenariosEnd = CI_SOURCE.indexOf("const evalCommand");
  assert(scenariosStart >= 0 && scenariosEnd > scenariosStart, "could not locate scenariosCommand body");
  const body = CI_SOURCE.slice(scenariosStart, scenariosEnd);
  assert(
    body.includes("EXA_SCENARIO_REPO_ROOT"),
    "scripts/ci.ts scenarios must set EXA_SCENARIO_REPO_ROOT for the deployed runner",
  );
});
