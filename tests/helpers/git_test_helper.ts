/**
 * @module GitTestHelpers
 * @path tests/helpers/git_test_helper.ts
 * @description Provides high-level utilities for Git-based integration tests,
 * including repository creation, commit simulation, and branch management.
 */

import { assert, assertEquals } from "@std/assert";
import { FlowStepType, MemoryOperation, PortalOperation } from "../../src/shared/enums.ts";
import { join } from "@std/path";
import { GitService } from "../../src/services/core/git_service.ts";
import { createMockConfig } from "./config.ts";
import { initTestDbService } from "./db.ts";
import type { DatabaseService as DatabaseService } from "../../src/services/core/db.ts";
import type { Config } from "../../src/shared/schemas/config.ts";
import { TEST_DEFAULT_BRANCH } from "./constants.ts";

/**
 * Git Test Helper
 *
 * Provides utilities for testing git operations with automatic setup/cleanup.
 */

export interface IGitTestContext {
  tempDir: string;
  repoDir: string;
  db: DatabaseService;
  cleanup: () => Promise<void>;
  config: Config;
  git: GitService;
}

/**
 * Helper to initialize git repository in a directory
 */
export async function setupGitRepo(
  path: string,
  options: { initialCommit?: boolean; branch?: string } = {},
): Promise<void> {
  const { initialCommit = false, branch = TEST_DEFAULT_BRANCH } = options;

  // Verify directory exists before running git commands
  try {
    const stat = await Deno.stat(path);
    if (!stat.isDirectory) {
      throw new Error(`Path is not a directory: ${path}`);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error(`Directory does not exist: ${path}`);
    }
    throw err;
  }

  const commands = [
    ["init", "-b", branch],
    ["config", "user.name", "Test User"],
    ["config", "user.email", "test@example.com"],
  ];

  for (const args of commands) {
    await new Deno.Command(PortalOperation.GIT, {
      args,
      cwd: path,
      stdout: "null",
      stderr: "null",
    }).output();
  }
  if (initialCommit) {
    await new Deno.Command(PortalOperation.GIT, {
      args: ["commit", "--allow-empty", "-m", "Initial commit"],
      cwd: path,
      stdout: "null",
      stderr: "null",
    }).output();
  }
}

/**
 * Creates a test environment with initialized git repository
 */
export async function createGitTestContext(prefix: string = "git-test-"): Promise<IGitTestContext> {
  const rawTempDir = await Deno.makeTempDir({ prefix });
  const tempDir = await Deno.realPath(rawTempDir);
  const { db, cleanup: dbCleanup } = await initTestDbService();

  // Create a separate repo directory so it's not the same as config.system.root
  const rawRepoDir = join(tempDir, "repo");
  await Deno.mkdir(rawRepoDir, { recursive: true });
  const repoDir = await Deno.realPath(rawRepoDir);

  // Initialize config with workspace portal pointing to repoDir
  const config = createMockConfig(tempDir, {
    portals: [{
      alias: "workspace",
      target_path: repoDir,
      default_branch: TEST_DEFAULT_BRANCH,
      identities_allowed: ["*"],
      operations: [],
    }],
  });

  const git = new GitService({
    config,
    db,
    repoPath: repoDir,
  });

  const cleanup = async () => {
    await dbCleanup();
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore if already deleted
    }
  };

  return { tempDir, repoDir, db, cleanup, config, git };
}

/**
 * Git Command Helper
 * Provides methods for common git operations in tests
 */
export class GitTestHelper {
  constructor(private repoPath: string) {}

  /**
   * Run a git command and return stdout
   */
  async runGit(args: string[]): Promise<string> {
    const cmd = new Deno.Command(PortalOperation.GIT, {
      args,
      cwd: this.repoPath,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout, success, stderr } = await cmd.output();
    if (!success) {
      const error = new TextDecoder().decode(stderr);
      throw new Error(`Git command failed: ${args.join(" ")}\n${error}`);
    }
    return new TextDecoder().decode(stdout).trim();
  }

  /**
   * Check if .git directory exists
   */
  async assertRepositoryExists(): Promise<void> {
    const gitDir = await Deno.stat(join(this.repoPath, ".git"));
    assertEquals(gitDir.isDirectory, true, "Expected .git directory to exist");
  }

  /**
   * Get current git user.name config (local)
   */
  async getUserName(): Promise<string> {
    return await this.runGit(["config", "--local", "user.name"]);
  }

  /**
   * Get current git user.email config (local)
   */
  async getUserEmail(): Promise<string> {
    return await this.runGit(["config", "--local", "user.email"]);
  }

  /**
   * Assert that a branch exists
   */
  async assertBranchExists(branchName: string): Promise<void> {
    const output = await this.runGit([FlowStepType.BRANCH, "--list", branchName]);
    assert(
      output.includes(branchName),
      `Expected branch '${branchName}' to exist, but it doesn't`,
    );
  }

  /**
   * Get the current branch name
   */
  async getCurrentBranch(): Promise<string> {
    return await this.runGit([FlowStepType.BRANCH, "--show-current"]);
  }

  /**
   * Get the last commit message
   */
  async getLastCommitMessage(): Promise<string> {
    return await this.runGit(["log", "-1", "--pretty=%B"]);
  }

  /**
   * Get the commit SHA for a given reference
   */
  async getCommitSha(ref: string = "HEAD"): Promise<string> {
    return await this.runGit(["rev-parse", ref]);
  }

  /**
   * List all branches
   */
  async listBranches(): Promise<string[]> {
    const output = await this.runGit([FlowStepType.BRANCH, "--format=%(refname:short)"]);
    return output.split("\n").filter((b) => b.trim().length > 0);
  }

  /**
   * Create a file with content
   */
  async createFile(path: string, content: string): Promise<void> {
    const fullPath = join(this.repoPath, path);
    await Deno.writeTextFile(fullPath, content);
  }

  /**
   * Stage all changes
   */
  async stageAll(): Promise<void> {
    await this.runGit([MemoryOperation.ADD, "."]);
  }

  /**
   * Create a commit directly (bypassing GitService)
   */
  async createCommit(message: string): Promise<string> {
    await this.runGit(["commit", "-m", message]);
    return await this.getCommitSha("HEAD");
  }

  /**
   * Create a file and commit it
   */
  async createFileAndCommit(
    filename: string,
    content: string,
    commitMessage: string,
  ): Promise<string> {
    await this.createFile(filename, content);
    await this.stageAll();
    return await this.createCommit(commitMessage);
  }

  /**
   * Get git status --porcelain output
   */
  async getStatus(): Promise<string> {
    return await this.runGit(["status", "--porcelain"]);
  }

  /**
   * Assert that working directory is clean
   */
  async assertCleanWorkingDir(): Promise<void> {
    const status = await this.getStatus();
    assertEquals(status, "", "Expected clean working directory");
  }

  /**
   * Get list of files changed in last commit
   */
  async getLastCommitFiles(): Promise<string[]> {
    const output = await this.runGit(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
    return output.split("\n").filter((f) => f.trim().length > 0);
  }

  /**
   * Assert that last commit message contains a string
   */
  async assertLastCommitContains(substring: string): Promise<void> {
    const message = await this.getLastCommitMessage();
    assert(
      message.includes(substring),
      `Expected commit message to contain '${substring}', but got:\n${message}`,
    );
  }
}
