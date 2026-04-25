/**
 * @module GitTestHelper
 * @path packages/git/tests/helpers/git_test_helper.ts
 * @description Package-local helpers for Git package tests.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createMockConfig } from "./config.ts";
import { initTestDbService } from "./db.ts";
import type { DatabaseService } from "../../../../src/services/core/db.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { GitService } from "../../src/git_service.ts";
import { PortalOperation } from "@exaix/core";
import { TEST_DEFAULT_BRANCH } from "./constants.ts";

export interface IGitTestContext {
  tempDir: string;
  repoDir: string;
  db: DatabaseService;
  cleanup: () => Promise<void>;
  config: Config;
  git: GitService;
}

export async function setupGitRepo(
  path: string,
  options: { initialCommit?: boolean; branch?: string } = {},
): Promise<void> {
  const { initialCommit = false, branch = TEST_DEFAULT_BRANCH } = options;

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

export async function createGitTestContext(prefix = "git-test-"): Promise<IGitTestContext> {
  const rawTempDir = await Deno.makeTempDir({ prefix });
  const tempDir = await Deno.realPath(rawTempDir);
  const { db, cleanup: dbCleanup } = await initTestDbService();

  const rawRepoDir = join(tempDir, "repo");
  await Deno.mkdir(rawRepoDir, { recursive: true });
  const repoDir = await Deno.realPath(rawRepoDir);

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

export class GitTestHelper {
  constructor(private repoPath: string) {}

  async runGit(args: string[]): Promise<string> {
    const cmd = new Deno.Command(PortalOperation.GIT, {
      args,
      cwd: this.repoPath,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout, success, stderr } = await cmd.output();
    if (!success) {
      throw new Error(
        `Git command failed: ${args.join(" ")}\n${new TextDecoder().decode(stderr)}`,
      );
    }
    return new TextDecoder().decode(stdout).trim();
  }

  async assertRepositoryExists(): Promise<void> {
    const gitDir = await Deno.stat(join(this.repoPath, ".git"));
    assertEquals(gitDir.isDirectory, true, "Expected .git directory to exist");
  }

  async getUserName(): Promise<string> {
    return await this.runGit(["config", "--local", "user.name"]);
  }

  async getUserEmail(): Promise<string> {
    return await this.runGit(["config", "--local", "user.email"]);
  }

  async assertBranchExists(branchName: string): Promise<void> {
    const output = await this.runGit(["branch", "--list", branchName]);
    assert(output.includes(branchName));
  }

  async getCurrentBranch(): Promise<string> {
    return await this.runGit(["branch", "--show-current"]);
  }

  async getLastCommitMessage(): Promise<string> {
    return await this.runGit(["log", "-1", "--pretty=%B"]);
  }

  async getCommitSha(ref = "HEAD"): Promise<string> {
    return await this.runGit(["rev-parse", ref]);
  }

  async listBranches(): Promise<string[]> {
    const output = await this.runGit(["branch", "--format=%(refname:short)"]);
    return output.split("\n").filter((line) => line.trim().length > 0);
  }

  async createFile(path: string, content: string): Promise<void> {
    const fullPath = join(this.repoPath, path);
    await Deno.writeTextFile(fullPath, content);
  }

  async stageAll(): Promise<void> {
    await this.runGit(["add", "."]);
  }

  async createCommit(message: string): Promise<string> {
    await this.runGit(["commit", "-m", message]);
    return await this.getCommitSha("HEAD");
  }

  async createFileAndCommit(filename: string, content: string, commitMessage: string): Promise<string> {
    await this.createFile(filename, content);
    await this.stageAll();
    return await this.createCommit(commitMessage);
  }

  async getStatus(): Promise<string> {
    return await this.runGit(["status", "--porcelain"]);
  }

  async assertCleanWorkingDir(): Promise<void> {
    const status = await this.getStatus();
    assertEquals(status, "", "Expected clean working directory");
  }

  async getLastCommitFiles(): Promise<string[]> {
    const output = await this.runGit(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
    return output.split("\n").filter((f) => f.trim().length > 0);
  }

  async assertLastCommitContains(substring: string): Promise<void> {
    const message = await this.getLastCommitMessage();
    assert(message.includes(substring));
  }
}
