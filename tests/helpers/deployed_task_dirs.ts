/**
 * @module DeployedTaskDirsHelper
 * @path tests/helpers/deployed_task_dirs.ts
 * @description Finds the top-level directories that deno.json task commands name and a deployed workspace does not hold.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [scripts/deploy_workspace.ts, tests/helpers/deploy_workspace_dirs_test.ts]
 */

import { WORKSPACE_COPY_DIRS } from "../../scripts/deploy_workspace.ts";

/** Top-level directories a deploy copies besides `WORKSPACE_COPY_DIRS`. */
const OTHER_DEPLOYED_DIRS: readonly string[] = ["Memory", "Blueprints", "docs", "scripts"];

/** Undeployed directories that kept tasks may name. Phase 229 decides what a deployed workspace runs. */
export const ALLOWED_UNDEPLOYED_DIRS: readonly string[] = ["coverage", "exaix-team", "tests"];

const DIR_TOKEN = /^[A-Za-z_.-]+\//;

/** The sorted top-level directories that the task commands name and a deployed workspace does not hold. */
export function undeployedDirsNamedBy(tasks: Readonly<Record<string, string>>): string[] {
  const deployed = new Set([...WORKSPACE_COPY_DIRS, ...OTHER_DEPLOYED_DIRS]);
  const named = new Set<string>();
  for (const command of Object.values(tasks)) {
    for (const rawToken of command.split(/\s+/)) {
      const token = rawToken.replace(/^\.\//, "");
      if (token.startsWith("-") || token.includes("=") || !DIR_TOKEN.test(token)) continue;
      const top = token.split("/")[0];
      if (!deployed.has(top)) named.add(top);
    }
  }
  return [...named].sort();
}
