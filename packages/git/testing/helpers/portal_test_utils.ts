/**
 * @module GitTestingPortalUtils
 * @path packages/git/testing/helpers/portal_test_utils.ts
 * @related-files []
 * @architectural-layer Services
 * @ungrounded
 * @description Shared portal Git repo setup helpers exported through @exaix/git/testing.
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import type { Config } from "@exaix/schemas";

import type { DatabaseService } from "@exaix/storage-sqlite";
import { createMockConfig } from "./config.ts";
import { initTestDbService } from "./db.ts";
import { setupGitRepo } from "./git_test_helper.ts";

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
