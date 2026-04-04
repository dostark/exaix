/**
 * @module PortalExecutionTestUtils
 * @path tests/helpers/portal_test_utils.ts
 * @description Provides common utilities for verifying agent execution across
 * different portals, ensuring correct file access and security boundary enforcement.
 */

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { setupGitRepo } from "./git_test_helper.ts";
import { TEST_DEFAULT_BRANCH } from "./constants.ts";
import type { Config } from "../../src/shared/schemas/config.ts";
import { PortalExecutionStrategy, PortalOperation, ToolName } from "../../src/shared/enums.ts";
import { ExecutionLoop } from "../../src/services/agent/execution_loop.ts";
import { EventLogger } from "../../src/services/core/event_logger.ts";
import { ReviewRegistry } from "../../src/services/artifact/review_registry.ts";
import type { TestEnvironment } from "../integration/helpers/test_environment.ts";
import { IReviewStatus, ReviewStatus } from "../../src/reviews/review_status.ts";
import { createMockConfig } from "./config.ts";
import { initTestDbService } from "./db.ts";
import type { DatabaseService } from "../../src/services/core/db.ts";

export interface IPortalTestSetup {
  portalAlias: string;
  portalTargetPath: string;
  config: Config;
  tempDir: string;
}

/**
 * Setup a portal test environment with git repository
 */
export async function setupPortalTest(
  tempDir: string,
  portalAlias: string = "write-portal",
  options?: { branch?: string; withSrcDir?: boolean },
): Promise<IPortalTestSetup> {
  const { branch = TEST_DEFAULT_BRANCH, withSrcDir = true } = options || {};
  const portalTargetPath = join(tempDir, "portal-write-target");

  if (withSrcDir) {
    await ensureDir(join(portalTargetPath, "src"));
  }

  await setupGitRepo(portalTargetPath, { initialCommit: true, branch });
  const config = createMockConfig(tempDir);

  return {
    portalAlias,
    portalTargetPath,
    config,
    tempDir,
  };
}

export interface IPortalGitRepoSetup {
  tempDir: string;
  portalRepoDir: string;
  workspaceRepoDir: string;
  config: Config;
  db: DatabaseService;
  cleanup: () => Promise<void>;
}

/**
 * Setup two paired git repositories (portal-repo and workspace-repo) for portal tests.
 */
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

/**
 * Helper to run exactl CLI command
 */
export async function runExactl(args: string[], cwd: string) {
  const repoRoot = join(dirname(fromFileUrl(import.meta.url)), "..", "..");
  const exactlPath = join(repoRoot, "src", "cli", "exactl.ts");

  const env = Deno.env.toObject();
  delete env.EXA_TEST_MODE;
  delete env.EXA_TEST_CLI_MODE;
  env.EXA_CONFIG_PATH = join(cwd, "exa.config.toml");

  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", exactlPath, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
    env,
  });

  const { code, stdout, stderr } = await command.output();
  const stdoutStr = new TextDecoder().decode(stdout);
  const stderrStr = new TextDecoder().decode(stderr);

  const effectiveStdout = stdoutStr.trim() ? stdoutStr : stderrStr;

  return {
    code,
    stdout: effectiveStdout,
    stderr: stderrStr,
  };
}

/**
 * Setup worktree portal repository with target branch
 */
export async function setupWorktreePortalRepo(
  portalTargetPath: string,
  targetBranch: string,
): Promise<void> {
  await ensureDir(join(portalTargetPath, "src"));
  await setupGitRepo(portalTargetPath, { initialCommit: true, branch: TEST_DEFAULT_BRANCH });
  await gitStdout(portalTargetPath, ["branch", targetBranch, TEST_DEFAULT_BRANCH]);
  await gitStdout(portalTargetPath, ["checkout", TEST_DEFAULT_BRANCH]);
  assertEquals(await gitStdout(portalTargetPath, ["branch", "--show-current"]), TEST_DEFAULT_BRANCH);
}

/**
 * Execute git command and return stdout or throw on error
 */
export async function gitStdout(repoPath: string, args: string[]): Promise<string> {
  const cmd = new Deno.Command(PortalOperation.GIT, {
    args,
    cwd: repoPath,
    stdout: "piped",
    stderr: "piped",
  });

  const { success, stdout, stderr } = await cmd.output();
  if (!success) {
    throw new Error(`Git command failed: ${args.join(" ")}\n${new TextDecoder().decode(stderr)}`);
  }

  return new TextDecoder().decode(stdout).trim();
}

/**
 * Execute git command and return success boolean
 */
export async function gitOk(repoPath: string, args: string[]): Promise<boolean> {
  const cmd = new Deno.Command(PortalOperation.GIT, {
    args,
    cwd: repoPath,
    stdout: "null",
    stderr: "null",
  });
  const { success } = await cmd.output();
  return success;
}

/**
 * List all branches
 */
export async function listBranches(portalPath: string): Promise<string[]> {
  const output = await gitStdout(portalPath, ["branch", "--list"]);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[*+]\s+/, ""));
}

/**
 * Check if path exists
 */
export async function pathExists(path: string): Promise<boolean> {
  return await Deno.stat(path).then(() => true).catch(() => false);
}

/**
 * Check if path exists without following symlinks
 */
export async function pathExistsNoFollow(path: string): Promise<boolean> {
  return await Deno.lstat(path).then(() => true).catch(() => false);
}

/**
 * Assert worktree pointer points to expected target
 */
export async function assertPointerPointsTo(
  traceRoot: string,
  traceId: string,
  expectedTarget: string,
): Promise<void> {
  const pointerPath = join(traceRoot, "Memory", "Execution", traceId, "worktree");
  const info = await Deno.lstat(pointerPath);

  if (info.isSymlink) {
    const linkTarget = await Deno.readLink(pointerPath);
    assertEquals(linkTarget, expectedTarget);
    return;
  }

  assertEquals(info.isDirectory, true);
  const pathText = await Deno.readTextFile(join(pointerPath, "PATH.txt"));
  assertEquals(pathText.trim(), expectedTarget);
}

/**
 * Helper to create a review registry for testing
 */
export function createReviewRegistry(env: TestEnvironment): {
  logger: EventLogger;
  reviewRegistry: ReviewRegistry;
} {
  const logger = new EventLogger({ db: env.db });
  const reviewRegistry = new ReviewRegistry(env.db, logger);
  return { logger, reviewRegistry };
}

/**
 * Helper to execute an approved plan for review/portal scenarios
 */
export async function executePlanForReview<TConfig extends Config>(
  env: TestEnvironment,
  config: TConfig,
  activePlanPath: string,
  reviewRegistry?: ReviewRegistry,
): Promise<{ success: boolean; traceId: string | undefined; error?: string }> {
  const loop = new ExecutionLoop({
    config,
    db: env.db,
    identityId: "daemon",
    reviewRegistry,
  });
  const result = await loop.processTask(activePlanPath);
  return { success: result.success, traceId: result.traceId, error: result.error };
}

/**
 * Approve a review via registry
 */
export async function approveReviewStatus(
  reviewRegistry: ReviewRegistry,
  reviewId: string,
  user: string = "test-user",
): Promise<void> {
  await reviewRegistry.updateStatus(reviewId, ReviewStatus.APPROVED, user);
}

/**
 * Create and run review plan helper
 */
export async function createAndRunReviewPlan<TConfig extends Config>(
  env: TestEnvironment,
  config: TConfig,
  params: {
    portalAlias: string;
    targetBranch: string;
    writePath: string;
    writeContent: string;
    identityId?: string;
  },
): Promise<{
  traceId: string;
  requestId: string;
  activePlanPath: string;
  result: { success: boolean; traceId: string | undefined; error?: string };
}> {
  const traceId = crypto.randomUUID();
  const requestId = `request-${traceId.substring(0, 8)}`;

  const planPath = await env.createPlan(traceId, requestId, {
    status: "review",
    identityId: params.identityId ?? "senior-coder",
    portal: params.portalAlias,
    targetBranch: params.targetBranch,
    actions: [{
      tool: ToolName.WRITE_FILE,
      params: { path: params.writePath, content: params.writeContent },
    }],
  });

  const activePlanPath = await env.approvePlan(planPath);
  const logger = new EventLogger({ db: env.db });
  const reviewRegistry = new ReviewRegistry(env.db, logger);
  const loop = new ExecutionLoop({ config, db: env.db, identityId: "daemon", reviewRegistry });
  const result = await loop.processTask(activePlanPath);

  return {
    traceId,
    requestId,
    activePlanPath,
    result: { success: result.success, traceId: result.traceId, error: result.error },
  };
}

/**
 * Create config with single worktree portal
 */
export function withSingleWorktreePortal<TConfig extends Config>(
  baseConfig: TConfig,
  portalAlias: string,
  portalTargetPath: string,
  defaultBranch: string,
): TConfig {
  return {
    ...baseConfig,
    portals: [{
      alias: portalAlias,
      target_path: portalTargetPath,
      default_branch: defaultBranch,
      execution_strategy: PortalExecutionStrategy.WORKTREE,
    }],
  };
}

/**
 * Higher-level helper to create request, plan, and execute it.
 * Reduces the massive boilerplate in e2e tests.
 */
export async function createAndRunReviewWorkflow<TConfig extends Config>(
  env: TestEnvironment,
  config: TConfig,
  params: {
    portalAlias: string;
    description: string;
    writePath: string;
    writeContent: string;
    identityId?: string;
    targetBranch?: string;
  },
): Promise<{
  traceId: string;
  requestId: string;
  result: { success: boolean; traceId: string | undefined; error?: string };
  reviewRegistry: ReviewRegistry;
}> {
  const { traceId } = await env.createRequest(params.description, {
    identityId: params.identityId ?? "senior-coder",
    portal: params.portalAlias,
    targetBranch: params.targetBranch,
  });

  const requestId = `request-${traceId.substring(0, 8)}`;

  const planPath = await env.createPlan(traceId, requestId, {
    status: "review",
    identityId: params.identityId ?? "senior-coder",
    portal: params.portalAlias,
    targetBranch: params.targetBranch,
    actions: [{
      tool: ToolName.WRITE_FILE,
      params: { path: params.writePath, content: params.writeContent },
    }],
  });

  const activePlanPath = await env.approvePlan(planPath);
  const { reviewRegistry } = createReviewRegistry(env);
  const result = await executePlanForReview(env, config, activePlanPath, reviewRegistry);

  return { traceId, requestId, result, reviewRegistry };
}

/**
 * Asserts that a specific branch exists in a portal repository.
 */
export async function assertPortalBranchExists(
  portalPath: string,
  branchPrefix: string,
): Promise<string> {
  const branches = await listBranches(portalPath);
  const matched = branches.find((b) => b.startsWith(branchPrefix));
  if (!matched) {
    throw new Error(`Expected branch starting with '${branchPrefix}' not found in ${portalPath}`);
  }
  return matched;
}

/**
 * Asserts that a file exists and has specific content in a git branch.
 */
export async function assertFileInBranch(
  repoPath: string,
  branch: string,
  filePath: string,
  expectedContent?: string,
): Promise<void> {
  const out = await gitStdout(repoPath, ["show", `${branch}:${filePath}`]);
  if (expectedContent) {
    if (!out.includes(expectedContent)) {
      throw new Error(`Content mismatch in ${filePath} on branch ${branch}`);
    }
  }
}

/**
 * Asserts a review status in the database.
 */
export async function assertReviewStatus(
  db: DatabaseService,
  traceId: string,
  expectedStatus: IReviewStatus,
): Promise<void> {
  const row = await db.preparedGet<{ status: string }>(
    "SELECT status FROM reviews WHERE trace_id = ?",
    [traceId],
  );
  if (!row) throw new Error(`Review for trace ${traceId} not found`);
  assertEquals(row.status, expectedStatus);
}

/**
 * Asserts the base_branch of a review in the database.
 */
export async function assertReviewBaseBranch(
  db: DatabaseService,
  traceId: string,
  expectedBaseBranch: string,
): Promise<void> {
  const row = await db.preparedGet<{ base_branch: string }>(
    "SELECT base_branch FROM reviews WHERE trace_id = ?",
    [traceId],
  );
  if (!row) throw new Error(`Review for trace ${traceId} not found`);
  assertEquals(row.base_branch, expectedBaseBranch);
}
