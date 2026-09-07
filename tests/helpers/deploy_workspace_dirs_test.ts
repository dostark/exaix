/**
 * @module DeployWorkspaceDirsTest
 * @path tests/helpers/deploy_workspace_dirs_test.ts
 * @description Tests for deploy_workspace.ts's Solo-edition copy set and deno.json rewrite.
 *   A Solo deploy must EXCLUDE exaix-team/ (BSL Team code must not ship in a Solo
 *   deployment — edition separation). This is safe because the app entry points load
 *   @exaix-team/* dynamically only in the editionType !== "solo" branch, so a Solo
 *   run never references Team modules. The deployed deno.json's workspace[] is rewritten to
 *   drop exaix-team members so Deno does not warn about absent workspace members.
 * @architectural-layer Test
 * @related-files [scripts/deploy_workspace.ts]
 */

import { assert, assertEquals } from "@std/assert";
import {
  type IDenoConfigShape,
  stripTeamWorkspaceMembers,
  WORKSPACE_COPY_DIRS,
} from "../../scripts/deploy_workspace.ts";

Deno.test("[deploy_workspace] the copy-dir set includes packages, apps, migrations", () => {
  for (const dir of ["packages", "apps", "migrations"]) {
    assert(
      WORKSPACE_COPY_DIRS.includes(dir),
      `deploy must copy ${dir}/ (regression guard)`,
    );
  }
});

Deno.test("[deploy_workspace] a Solo deploy EXCLUDES exaix-team/ (no BSL Team source in a Solo deploy)", () => {
  // Team code is loaded dynamically only in the Team branch, so a Solo run never
  // needs exaix-team/ on disk. Shipping it would leak BSL source into a Solo deployment.
  assert(
    !WORKSPACE_COPY_DIRS.includes("exaix-team"),
    "Solo deploy must NOT copy exaix-team/ — edition separation",
  );
});

Deno.test("[deploy_workspace] stripTeamWorkspaceMembers drops exaix-team/* workspace entries", () => {
  const config = {
    workspace: [
      "./packages/core",
      "./packages/quality-gate",
      "./exaix-team/team-composer",
      "./exaix-team/voting",
      "./packages/routing",
    ],
    imports: { "@exaix/core": "./packages/core/mod.ts" },
  };
  const stripped = stripTeamWorkspaceMembers(config);
  assertEquals(stripped.workspace, [
    "./packages/core",
    "./packages/quality-gate",
    "./packages/routing",
  ]);
  // Non-workspace fields are preserved.
  assertEquals((stripped as typeof config).imports, config.imports);
});

Deno.test("[deploy_workspace] stripTeamWorkspaceMembers is a no-op when there is no workspace array", () => {
  const config: IDenoConfigShape & { imports: Record<string, string> } = {
    imports: { "@exaix/core": "./packages/core/mod.ts" },
  };
  assertEquals(stripTeamWorkspaceMembers(config), config);
});
