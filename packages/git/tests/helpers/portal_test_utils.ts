/**
 * @module GitPortalTestUtils
 * @path packages/git/tests/helpers/portal_test_utils.ts
 * @description Minimal portal helpers for Git package tests.
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { setupGitRepo } from "./git_test_helper.ts";
import { createMockConfig } from "./config.ts";
import { initTestDbService } from "./db.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { DatabaseService } from "../../../../src/services/core/db.ts";

export interface IPortalGitRepoSetup {
  tempDir: string;
  portalRepoDir: string;
  workspaceRepoDir: string;
  config: Config;
  db: DatabaseService;
  cleanup: () => Promise<void>;
}

export async function setupPortalGitRepos(): Promise<IPortalGitRepoSetup> {
  const { db, tempDir, cleanup } = await initTestDbService();
  const portalRepoDir = join(tempDir, "portal-repo");
  const workspaceRepoDir = join(tempDir, "workspace-repo");

  await ensureDir(portalRepoDir);
  await ensureDir(workspaceRepoDir);
  await setupGitRepo(portalRepoDir, { initialCommit: true });
  await setupGitRepo(workspaceRepoDir, { initialCommit: true });

  const config = createMockConfig(tempDir);
  return { tempDir, portalRepoDir, workspaceRepoDir, config, db, cleanup };
}
