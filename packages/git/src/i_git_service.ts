/**
 * @module IGitService
 * @path packages/git/src/i_git_service.ts
 * @related-files []
 * @architectural-layer Services
 * @ungrounded
 * @description Git service interface definitions for @exaix/git.
 */

import type { Config } from "@exaix/schemas";
import type { IEventLogger } from "@exaix/core/logger";

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
  removeWorktree(
    worktreePath: string,
    options?: { force?: boolean; deleteBranch?: boolean },
  ): Promise<void>;
  pruneWorktrees(options?: { dryRun?: boolean; verbose?: boolean; expire?: string }): Promise<string>;
  listWorktrees(): Promise<IWorktreeInfo[]>;
  runGitCommand(args: string[], options?: IGitCommandOptions): Promise<{ output: string; exitCode: number }>;
  validateArgs(args: string[]): { valid: boolean; reason?: string };
}

export interface IGitDatabaseService {
  logActivity(
    actor: string,
    actionType: string,
    target: string | null,
    payload: Record<string, JsonValue>,
    traceId?: string,
    actorType?: string | null,
    agentRole?: string | null,
    runnerKind?: string | null,
    promptTokens?: number,
    completionTokens?: number,
    costUsd?: number,
  ): void;
}

export interface IGitServiceContext {
  config?: Config | { get(): Config };
}

export interface IGitServiceConfig {
  config: Config;
  logger?: IEventLogger;
  traceId?: string;
  agentRole?: string;
  repoPath?: string;
  context?: IGitServiceContext;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
