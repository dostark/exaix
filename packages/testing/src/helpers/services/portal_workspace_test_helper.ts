/**
 * @module PortalWorkspaceTestHelper
 * @path packages/testing/src/helpers/services/portal_workspace_test_helper.ts
 * @related-files []
 * @architectural-layer Testing
 * @ungrounded
 * @description Provides a reusable test harness for partitioned portal repositories,
 * ensuring stable discovery of portal-bound files and metadata.
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { PortalOperation } from "@exaix/core";
import type { IPortalPermissions } from "@exaix/schemas/portal_permissions.ts";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { TEST_BLUEPRINTS_DIR, TEST_PORTAL_ALIAS, TEST_PORTAL_NAME } from "../constants.ts";

export async function setupPortalWorkspaceTestDirs(tempDir: string): Promise<{
  portalDir: string;
  workspaceDir: string;
  portalConfig: IPortalPermissions;
}> {
  const portalDir = join(tempDir, "portal");
  const workspaceDir = join(tempDir, TEST_PORTAL_ALIAS);

  // Create directories with git repos
  await ensureDir(join(portalDir, ".git"));
  await ensureDir(join(workspaceDir, ".git"));
  await ensureDir(join(portalDir, TEST_BLUEPRINTS_DIR, "Agents"));

  const portalConfig: IPortalPermissions = {
    alias: TEST_PORTAL_NAME,
    target_path: portalDir,
    default_branch: TEST_DEFAULT_BRANCH,
    operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
    agents_allowed: ["*"],
  };

  return { portalDir, workspaceDir, portalConfig };
}
