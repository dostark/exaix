/**
 * @module ScenarioRepoRootVariableTest
 * @path tests/scenario_framework/tests/unit/scenario_repo_root_variable_test.ts
 * @description Scenarios reach repo-root assets (deno.json, scripts/, migrations, configs)
 *   through $REPO_ROOT, not by walking up from $FRAMEWORK_HOME. A deployed framework's
 *   $FRAMEWORK_HOME/../../ is a temp directory, so the walk-up form cannot be deployed.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts, tests/scenario_framework/runner/scenario_templates.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { walk } from "@std/fs";
import { SCENARIO_SUBSTITUTED_VARIABLES } from "../../runner/synthetic_runner.ts";

const FRAMEWORK_HOME = resolve(import.meta.dirname!, "..", "..");
const SCENARIOS_DIR = join(FRAMEWORK_HOME, "scenarios");
const TEMPLATES = join(FRAMEWORK_HOME, "runner", "scenario_templates.ts");

/** Every `$FRAMEWORK_HOME/../..` walk-up in a scenario tree or the template generator. */
async function walkUpReferences(): Promise<string[]> {
  const hits: string[] = [];
  const files: string[] = [TEMPLATES];
  for await (const entry of walk(SCENARIOS_DIR, { exts: [".yaml"], includeDirs: false })) {
    files.push(entry.path);
  }
  for (const path of files) {
    const text = await Deno.readTextFile(path);
    if (text.includes("$FRAMEWORK_HOME/../..")) hits.push(path.slice(FRAMEWORK_HOME.length + 1));
  }
  return hits;
}

Deno.test("[scenario-vars] $REPO_ROOT is a runner-substituted variable", () => {
  assert(
    SCENARIO_SUBSTITUTED_VARIABLES.includes("REPO_ROOT"),
    "the runner must define $REPO_ROOT so a deployed scenario can reach repo assets",
  );
});

Deno.test("[scenario-vars] no scenario or template reaches the repo by walking up from $FRAMEWORK_HOME", async () => {
  // $FRAMEWORK_HOME/../.. is the repo root only when the framework runs in-repo.
  // A deployed framework resolves it to the deploy temp dir, so it breaks.
  // $REPO_ROOT is the deploy-safe spelling.
  const hits = await walkUpReferences();
  assertEquals(
    hits,
    [],
    `these use $FRAMEWORK_HOME/../.. instead of $REPO_ROOT:\n${hits.join("\n")}`,
  );
});
