/**
 * @module GitCommands
 * @path apps/exactl/src/commands/git_commands.ts
 * @description Provides CLI commands for repository interaction, including trace-id aware branch listing, commit history, and status reporting.
 * @architectural-layer CLI
 * @related-files ["packages/git/src/git_service.ts", "apps/daemon/main.ts"]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { GIT_CMD_BRANCH } from "@exaix/git/constants.ts";
import type { Opt, Reason } from "@exaix/core/types";

export interface IBranchInfo {
  name: string;
  is_current: boolean;
  last_commit: string;
  last_commit_date: string;
  trace_id?: string;
}

export interface ICommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
  trace_id?: string;
}

/**
 * Commands for git repository operations
 */
export class GitCommands extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  async listBranches(pattern?: Opt<string, Reason.OptionalInput>): Promise<IBranchInfo[]> {
    const workspaceRoot = this.config.system.root;

    const args = [
      "-C",
      workspaceRoot,
      GIT_CMD_BRANCH,
      "--format=%(HEAD)|%(refname:short)|%(objectname:short)|%(committerdate:iso-strict)",
      "--sort=-committerdate",
    ];

    if (pattern) {
      args.push("--list", pattern);
    }

    const output = await this.runGitCommand(args);
    const lines = output.trim().split("\n").filter((l) => l);
    const branches: IBranchInfo[] = [];

    for (const line of lines) {
      const [head, name, commit, date] = line.split("|");

      // Try to extract trace_id from commit message
      const logCmd = new Deno.Command("git", {
        args: ["-C", workspaceRoot, "log", name, "-1", "--format=%B"],
        stdout: "piped",
        stderr: "piped",
      });

      const logResult = await logCmd.output();
      const commitMsg = new TextDecoder().decode(logResult.stdout);
      const traceMatch = commitMsg.match(/Trace-Id:\s*([0-9a-f-]+)/i);

      branches.push({
        name,
        is_current: head === "*",
        last_commit: commit,
        last_commit_date: date,
        trace_id: traceMatch?.[1],
      });
    }

    return branches;
  }

  async showBranch(branchName: string): Promise<{ branch: IBranchInfo; commits: ICommitInfo[] }> {
    const workspaceRoot = this.config.system.root;

    // Get branch info
    const branches = await this.listBranches(branchName);
    const branch = branches.find((b) => b.name === branchName);

    if (!branch) {
      throw new Error(`Branch not found: ${branchName}`);
    }

    // Get commit history (last 10 commits)
    const logCmd = new Deno.Command("git", {
      args: [
        "-C",
        workspaceRoot,
        "log",
        branchName,
        "-10",
        "--format=%H|||%s|||%an|||%aI|||%B",
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout, success } = await logCmd.output();
    if (!success) {
      throw new Error(`Failed to get commit history for ${branchName}`);
    }

    const commits: ICommitInfo[] = [];
    const entries = new TextDecoder().decode(stdout).split("\n\n").filter((e) => e);

    for (const entry of entries) {
      const [header] = entry.split("\n");
      const [sha, message, author, date] = header.split("|||");

      // Extract trace_id from full commit body
      const traceMatch = entry.match(/Trace-Id:\s*([0-9a-f-]+)/i);

      commits.push({
        sha,
        message,
        author,
        date,
        trace_id: traceMatch?.[1],
      });
    }

    return { branch, commits };
  }

  async status(): Promise<{
    branch: string;
    modified: string[];
    added: string[];
    deleted: string[];
    untracked: string[];
  }> {
    const workspaceRoot = this.config.system.root;

    // Get current branch
    const branchCmd = new Deno.Command("git", {
      args: ["-C", workspaceRoot, GIT_CMD_BRANCH, "--show-current"],
      stdout: "piped",
      stderr: "piped",
    });

    const branchResult = await branchCmd.output();
    const branch = new TextDecoder().decode(branchResult.stdout).trim();

    // Get status in porcelain format
    const statusCmd = new Deno.Command("git", {
      args: ["-C", workspaceRoot, "status", "--porcelain"],
      stdout: "piped",
      stderr: "piped",
    });

    const statusResult = await statusCmd.output();
    const lines = new TextDecoder().decode(statusResult.stdout).trim().split("\n").filter((l) => l);

    const modified: string[] = [];
    const added: string[] = [];
    const deleted: string[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3);

      if (status === "??") {
        untracked.push(file);
      } else if (status.includes("M")) {
        modified.push(file);
      } else if (status.includes("A")) {
        added.push(file);
      } else if (status.includes("D")) {
        deleted.push(file);
      }
    }

    return { branch, modified, added, deleted, untracked };
  }

  async logByTraceId(traceId: string): Promise<ICommitInfo[]> {
    const workspaceRoot = this.config.system.root;

    // Search all commits for trace_id
    const logCmd = new Deno.Command("git", {
      args: [
        "-C",
        workspaceRoot,
        "log",
        "--all",
        "--grep",
        `Trace-Id: ${traceId}`,
        "--format=%H|||%s|||%an|||%aI",
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout, success } = await logCmd.output();
    if (!success) {
      return [];
    }

    const lines = new TextDecoder().decode(stdout).trim().split("\n").filter((l) => l);
    const commits: ICommitInfo[] = [];

    for (const line of lines) {
      const [sha, message, author, date] = line.split("|||");
      commits.push({
        sha,
        message,
        author,
        date,
        trace_id: traceId,
      });
    }

    return commits;
  }

  /** Diff for `ref`; `compare` defaults to the parent commit. */
  async diff(ref: string, compare?: Opt<string, Reason.OptionalInput>): Promise<string> {
    const workspaceRoot = this.config.system.root;

    const args = ["-C", workspaceRoot, "diff"];
    if (compare) {
      args.push(`${compare}...${ref}`);
    } else {
      args.push(`${ref}^..${ref}`);
    }

    return await this.runGitCommand(args);
  }

  private async runGitCommand(args: string[]): Promise<string> {
    const cmd = new Deno.Command("git", {
      args,
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout, success } = await cmd.output();
    if (!success) {
      throw new Error(`Git command failed: git ${args.join(" ")}`);
    }

    return new TextDecoder().decode(stdout);
  }
}
