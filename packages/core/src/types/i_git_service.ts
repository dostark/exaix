/**
 * @module IGitService
 * @path packages/core/src/types/i_git_service.ts
 * @description Interface for Git operations.
 * @architectural-layer Shared
 * @related-files [packages/git/src/git_service.ts, packages/cli/src/types/cli_context.ts, apps/exactl/src/commands/review_commands.ts, "packages/core/src/planning/plan_executor.ts", "packages/execution/src/execution_loop.ts", apps/exactl/src/exactl.ts]
 */

export interface IBranchOptions {
  requestId: string;
  traceId: string;
}

export interface ICommitOptions {
  message: string;
  description?: string;
  traceId: string;
}

export interface IGitCommandOptions {
  throwOnError?: boolean;
  timeoutMs?: number;
  retryOnLock?: boolean;
}

export interface IWorktreeInfo {
  path: string;
  head?: string;
  branch?: string;
  detached?: boolean;
  locked?: boolean;
  prunable?: boolean;
}

export interface IGitService {
  setRepository(repoPath: string): void;
  getRepository(): string;
  ensureRepository(): Promise<void>;
  ensureIdentity(): Promise<void>;
  createBranch(options: IBranchOptions): Promise<string>;
  commit(options: ICommitOptions): Promise<string>;
  checkoutBranch(branchName: string, options?: { allowProtected?: boolean }): Promise<void>;
  getCurrentBranch(): Promise<string>;
  getDefaultBranch(repoPath?: string): Promise<string>;
  addWorktree(worktreePath: string, baseBranch: string): Promise<void>;
  removeWorktree(worktreePath: string, options?: { force?: boolean }): Promise<void>;
  pruneWorktrees(options?: { dryRun?: boolean; verbose?: boolean; expire?: string }): Promise<string>;
  listWorktrees(): Promise<IWorktreeInfo[]>;
  runGitCommand(
    args: string[],
    options?: IGitCommandOptions,
  ): Promise<{ output: string; exitCode: number }>;
}
