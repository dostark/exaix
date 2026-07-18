/**
 * @module GitExecutionSetupBaseBranchTest
 * @path packages/execution/tests/git_execution_setup_base_branch_test.ts
 * @description Verifies GitExecutionSetupService.resolveBaseBranch resolves the base
 * branch from the repository's actual state rather than insisting on a configured
 * default_branch that does not exist in the repo. A portal registered without an
 * explicit default_branch carries the schema default ("main"), but a repo created
 * with `git init` is typically on "master" — the worktree base branch must follow
 * the repo, not the assumed name.
 */

import { assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { GitService } from "@exaix/git";
import { setupGitRepo } from "@exaix/git/testing";
import { createMockConfig } from "@exaix/testing";
import { GitExecutionSetupService } from "../src/git_execution_setup_service.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { PlanFrontmatter } from "@exaix/schemas/plan_schema.ts";

describe("GitExecutionSetupService.resolveBaseBranch", () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(async () => {
    tempDir = await Deno.makeTempDir({ prefix: "base-branch-test-" });
    repoDir = join(tempDir, "portal-repo");
    await Deno.mkdir(repoDir);
  });

  afterEach(async () => {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  });

  function buildService(portalDefaultBranch: string): GitExecutionSetupService {
    const config: Config = createMockConfig(tempDir, {
      portals: [{
        alias: "portal-repo",
        target_path: repoDir,
        default_branch: portalDefaultBranch,
        identities_allowed: ["*"],
        operations: [],
      }],
    });
    return new GitExecutionSetupService(config);
  }

  const frontmatter = { portal: "portal-repo" } as PlanFrontmatter;

  it("falls back to the repo's actual branch when the configured default_branch does not exist", async () => {
    // Repo is on "master"; portal config carries the schema default "main".
    await setupGitRepo(repoDir, { initialCommit: true, branch: "master" });
    const service = buildService("main");
    const gitService = new GitService({ config: { system: { root: repoDir } } as Config, repoPath: repoDir });

    const resolved = await service.resolveBaseBranch(frontmatter, gitService, repoDir);

    assertEquals(resolved, "master");
  });

  it("honors the configured default_branch when it exists in the repo", async () => {
    await setupGitRepo(repoDir, { initialCommit: true, branch: "develop" });
    const service = buildService("develop");
    const gitService = new GitService({ config: { system: { root: repoDir } } as Config, repoPath: repoDir });

    const resolved = await service.resolveBaseBranch(frontmatter, gitService, repoDir);

    assertEquals(resolved, "develop");
  });

  it("prefers an explicit plan target_branch when that branch exists", async () => {
    await setupGitRepo(repoDir, { initialCommit: true, branch: "master" });
    const service = buildService("main");
    const gitService = new GitService({ config: { system: { root: repoDir } } as Config, repoPath: repoDir });
    // Create the branch the plan asks for so it is a valid ref.
    await gitService.runGitCommand(["-C", repoDir, "branch", "release"], { throwOnError: false });

    const resolved = await service.resolveBaseBranch(
      { portal: "portal-repo", target_branch: "release" } as PlanFrontmatter,
      gitService,
      repoDir,
    );

    assertEquals(resolved, "release");
  });
});
