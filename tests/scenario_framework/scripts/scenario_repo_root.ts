/**
 * @module ScenarioScriptRepoRoot
 * @path tests/scenario_framework/scripts/scenario_repo_root.ts
 * @description Resolves the repo root for scenario scripts that spawn repo-relative
 *   processes. EXA_SCENARIO_REPO_ROOT wins, so a framework deployed outside the repo
 *   still finds exaix-team/ and deno.json. Without it, derive the root from the script's
 *   own location.
 * @architectural-layer Test
 * @dependencies [@std/path]
 */

import { resolve } from "@std/path";

/** Env var a caller sets to name the real repo root for a framework deployed outside it. */
export const SCENARIO_REPO_ROOT_ENV = "EXA_SCENARIO_REPO_ROOT";

/** The repo root: EXA_SCENARIO_REPO_ROOT when set, else three levels up from a script in
 *  tests/scenario_framework/scripts/. */
export function scenarioRepoRoot(scriptDirectory: string): string {
  const override = Deno.env.get(SCENARIO_REPO_ROOT_ENV);
  if (override && override.length > 0) return resolve(override);
  return resolve(scriptDirectory, "..", "..", "..");
}
