/**
 * @module DeployWorkspaceDirsTest
 * @path tests/helpers/deploy_workspace_dirs_test.ts
 * @description Phase 127 Step 5 (deploy fix) — RED-first test for the set of source dirs
 *   deploy_workspace.ts copies into a deployable workspace. The deploy copies deno.json
 *   (whose import map points @exaix-team/* at ./packages-team/ and whose `workspace` array
 *   lists packages-team members) and apps/ (which statically import @exaix-team/team-composer),
 *   but historically did NOT copy packages-team/ — so a deployed exactl/daemon failed with
 *   `Module not found ".../packages-team/team-composer/mod.ts"`. The copy-dir set must include
 *   packages-team so the import map + workspace members resolve.
 * @architectural-layer Test
 * @related-files [scripts/deploy_workspace.ts]
 */

import { assert } from "@std/assert";
import { WORKSPACE_COPY_DIRS } from "../../scripts/deploy_workspace.ts";

Deno.test("[deploy_workspace] the copy-dir set includes packages, apps, migrations", () => {
  for (const dir of ["packages", "apps", "migrations"]) {
    assert(
      WORKSPACE_COPY_DIRS.includes(dir),
      `deploy must copy ${dir}/ (regression guard)`,
    );
  }
});

Deno.test("[deploy_workspace] the copy-dir set includes packages-team (Team imports resolve in a Solo deploy)", () => {
  // apps/exactl + apps/daemon statically import @exaix-team/* (dead-code-eliminated at
  // runtime in Solo, but still must RESOLVE at module load), so the deploy must ship
  // packages-team/ alongside the deno.json that maps @exaix-team/* into it.
  assert(
    WORKSPACE_COPY_DIRS.includes("packages-team"),
    "deploy must copy packages-team/ so @exaix-team/* import-map targets + workspace members resolve",
  );
});
