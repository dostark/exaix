/**
 * @module IGitService
 * @path packages/core/src/types/i_git_service.ts
 * @description Interface for Git operations.
 * @architectural-layer Shared
 * @related-files [src/services/core/git_service.ts, src/cli/cli_context.ts, src/cli/commands/review_commands.ts, src/services/plan_executor.ts, src/services/execution_loop.ts, src/cli/exactl.ts]
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
