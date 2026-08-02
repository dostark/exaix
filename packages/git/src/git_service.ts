/**
 * @module GitService
 * @path packages/git/src/git_service.ts
 * @description Orchestrates Git operations with trace metadata.
 *
 * Features:
 * - Repository initialization and configuration
 * - Branch management for agent work
 * - Commits with automated messages and trace metadata
 * - Diff generation and status checks
 *
 * @architectural-layer Services
 * @related-files ["packages/core/src/planning/plan_executor.ts"]
 */

import type { Config } from "@exaix/schemas";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";

import {
  DEFAULT_GIT_BRANCH_NAME_COLLISION_MAX_RETRIES,
  DEFAULT_GIT_BRANCH_SUFFIX_LENGTH,
  DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  DEFAULT_GIT_EXIT_CODE_FATAL,
  DEFAULT_GIT_MAX_RETRIES,
  DEFAULT_GIT_RETRY_BACKOFF_BASE_MS,
  DEFAULT_GIT_TRACE_ID_SHORT_LENGTH,
  GIT_CMD_ADD,
  GIT_CMD_BRANCH,
  GIT_CMD_CONFIG,
  GIT_CMD_INIT,
  GIT_CMD_LIST,
  GIT_CMD_REMOVE,
  GIT_CMD_REV_PARSE,
  GIT_CMD_STATUS,
  GIT_CMD_WORKTREE,
} from "./constants.ts";
import { GitBranchName } from "./enums.ts";
import type {
  IBranchOptions,
  ICommitOptions,
  IGitCommandOptions,
  IGitService,
  IGitServiceConfig,
  IWorktreeInfo,
  JsonValue,
} from "./i_git_service.ts";

import type { Opt, Reason } from "@exaix/core/types";

type GitServiceError = Error | string | Record<string, JsonValue>;

const DAEMON_IDENTITY_ID = "daemon";

function getRandomString(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

// ============================================================================
// Types
// ============================================================================

// ============================================================================
// Git Error Classes
// ============================================================================

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

export class GitTimeoutError extends GitError {
  constructor(message: string) {
    super(message);
    this.name = "GitTimeoutError";
  }
}

export class GitLockError extends GitError {
  constructor(message: string) {
    super(message);
    this.name = "GitLockError";
  }
}

export class GitRepositoryError extends GitError {
  constructor(message: string) {
    super(message);
    this.name = "GitRepositoryError";
  }
}

export class GitCorruptionError extends GitError {
  constructor(message: string) {
    super(message);
    this.name = "GitCorruptionError";
  }
}

export class GitNothingToCommitError extends GitError {
  constructor(message: string) {
    super(message);
    this.name = "GitNothingToCommitError";
  }
}

export class GitSecurityError extends GitError {
  constructor(message: string) {
    super(message);
    this.name = "GitSecurityError";
  }
}

// ============================================================================
// GitService Implementation
// ============================================================================

export class GitService implements IGitService {
  private config: Config;
  private logger?: IEventLogger;
  private traceId?: string;
  private identityId?: string;
  private repoPath: string;

  constructor(options: IGitServiceConfig) {
    const ctx = options.context;
    const configSource = ctx?.config;
    this.config = configSource && typeof (configSource as { get?: () => Config }).get === "function"
      ? (configSource as { get(): Config }).get()
      : options.config;
    this.logger = options.logger && options.identityId
      ? options.logger.child({ identityId: options.identityId })
      : options.logger;
    this.traceId = options.traceId;
    this.identityId = options.identityId;
    this.repoPath = options.repoPath || this.config.system.root;
  }

  /**
   * Set the repository path for git operations
   * Validates that the path exists and is a git repository
   *
   * @param repoPath - Absolute path to git repository
   * @throws GitRepositoryError if path is invalid or not a git repository
   */
  setRepository(repoPath: string): void {
    // Validate directory exists
    try {
      const stat = Deno.statSync(repoPath);
      if (!stat.isDirectory) {
        throw new GitRepositoryError(`Not a directory: ${repoPath}`);
      }
    } catch (error) {
      if (error instanceof GitRepositoryError) throw error;
      throw new GitRepositoryError(`Not a git repository: ${repoPath}`);
    }

    // Validate .git directory exists
    try {
      const gitStat = Deno.statSync(`${repoPath}/.git`);
      if (!gitStat.isDirectory) {
        throw new GitRepositoryError(`Not a git repository: ${repoPath}`);
      }
    } catch {
      throw new GitRepositoryError(`Not a git repository: ${repoPath}`);
    }

    this.repoPath = repoPath;
  }

  /**
   * Get the current repository path
   *
   * @returns Absolute path to current git repository
   */
  getRepository(): string {
    return this.repoPath;
  }

  /**
   * Ensure git repository is initialized
   */
  async ensureRepository(): Promise<void> {
    const startTime = Date.now();

    try {
      // Check if .git directory exists
      try {
        await Deno.stat(`${this.repoPath}/.git`);
        // Repository exists; ensure it has at least one commit.
        const headResult = await this.runGitCommand([GIT_CMD_REV_PARSE, "--verify", "HEAD"], { throwOnError: false });
        if (headResult.exitCode === 0) {
          this.logActivity(DomainEventType.GitCheck, { status: "exists", duration_ms: Date.now() - startTime });
          return;
        }

        // Unborn HEAD (e.g., repo was `git init`'d but never committed).
        await this.ensureIdentity();
        await this.createInitialCommit();

        this.logActivity(DomainEventType.GitInit, {
          success: true,
          status: "initialized_existing_repo",
          duration_ms: Date.now() - startTime,
        });
        return;
      } catch {
        // .git doesn't exist, need to initialize
      }

      // Initialize repository with explicit default branch
      const initCmd = new Deno.Command("git", {
        args: [GIT_CMD_INIT, "-b", "master"],
        cwd: this.repoPath,
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stderr } = await initCmd.output();

      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error(`Failed to initialize git repository: ${error}`);
      }

      await this.ensureIdentity();

      // Create initial commit
      await this.createInitialCommit();

      this.logActivity(DomainEventType.GitInit, {
        success: true,
        duration_ms: Date.now() - startTime,
      });
    } catch (error) {
      this.logActivity(DomainEventType.GitInit, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Create initial commit for new repository
   */
  private async createInitialCommit(): Promise<void> {
    const workspaceDir = this.config.paths.workspace;
    const runtimeDir = this.config.paths.runtime;

    await Deno.writeTextFile(
      `${this.repoPath}/.gitignore`,
      `${workspaceDir}/\n${runtimeDir}/journal.db\n${runtimeDir}/journal.db-*\n${runtimeDir}/daemon.*\ndeno.lock\n`,
    );

    // Stage .gitignore
    await this.runGitCommand(["add", ".gitignore"]);

    // Commit
    await this.runGitCommand([
      "commit",
      "-m",
      "Initial commit\n\n[Exaix: Repository initialized]",
    ]);
  }

  /**
   * Ensure git identity is configured
   */
  async ensureIdentity(): Promise<void> {
    const startTime = Date.now();

    try {
      // Check if local identity exists
      const nameResult = await this.runGitCommand([GIT_CMD_CONFIG, "--local", "user.name"], { throwOnError: false });
      const emailResult = await this.runGitCommand([GIT_CMD_CONFIG, "--local", "user.email"], { throwOnError: false });

      if (nameResult.output.trim() && emailResult.output.trim()) {
        // Identity already configured
        this.logActivity(DomainEventType.GitIdentityCheck, {
          status: "exists",
          duration_ms: Date.now() - startTime,
        });
        return;
      }

      // Configure default identity (local to this repo)
      await this.runGitCommand([GIT_CMD_CONFIG, "--local", "user.name", "Exaix Bot"]);
      await this.runGitCommand([GIT_CMD_CONFIG, "--local", "user.email", "bot@exaix.local"]);

      this.logActivity(DomainEventType.GitIdentityConfigured, {
        success: true,
        user: "Exaix Bot",
        email: "bot@exaix.local",
        duration_ms: Date.now() - startTime,
      });
    } catch (error) {
      this.logActivity(DomainEventType.GitIdentityConfigured, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Create a feature branch with naming convention
   */
  async createBranch(options: IBranchOptions): Promise<string> {
    const startTime = Date.now();

    try {
      // Ensure identity is configured before creating branch
      await this.ensureIdentity();

      // Extract first N chars of traceId for branch name
      const shortTrace = options.traceId.substring(0, DEFAULT_GIT_TRACE_ID_SHORT_LENGTH);
      const baseName = `feat/${options.requestId}-${shortTrace}`;
      let branchName = baseName;

      // Retry loop for branch creation
      const maxRetries = DEFAULT_GIT_BRANCH_NAME_COLLISION_MAX_RETRIES;
      let lastError: Error | null = null;

      for (let i = 0; i < maxRetries; i++) {
        try {
          if (i === 0) {
            // First try: check if base name exists
            const listResult = await this.runGitCommand([GIT_CMD_BRANCH, "--list", branchName], {
              throwOnError: false,
            });
            if (listResult.output.trim()) {
              // Branch exists, try with timestamp first
              const timestamp = Date.now().toString(36);
              branchName = `${baseName}-${timestamp}`;
            }
          } else {
            // For retries, append random suffix
            const suffix = getRandomString(DEFAULT_GIT_BRANCH_SUFFIX_LENGTH);
            branchName = `${baseName}-${suffix}`;
          }

          // Create and checkout branch
          await this.runGitCommand(["checkout", "-b", branchName]);

          this.logActivity(DomainEventType.GitBranchCreated, {
            success: true,
            branch: branchName,
            request_id: options.requestId,
            trace_id: options.traceId,
            duration_ms: Date.now() - startTime,
            attempts: i + 1,
          });

          return branchName;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const errorMessage = lastError.message;

          // Check if error is about existing reference
          if (
            errorMessage.includes("already exists") ||
            errorMessage.includes("cannot lock ref")
          ) {
            // Continue to next iteration to try new name
            continue;
          }

          // If other error, throw immediately
          throw lastError;
        }
      }

      throw lastError || new Error("Failed to create branch after retries");
    } catch (error) {
      this.logActivity(DomainEventType.GitBranchCreated, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Commit changes with trace_id in message footer
   */
  async commit(options: ICommitOptions): Promise<string> {
    const startTime = Date.now();

    try {
      // Check if there are changes to commit
      const statusResult = await this.runGitCommand([GIT_CMD_STATUS, "--porcelain"]);

      if (!statusResult.output.trim()) {
        throw new GitNothingToCommitError("nothing to commit, working tree clean");
      }

      // Stage all changes
      await this.runGitCommand(["add", "."]);

      // Build commit message
      let message = options.message;

      if (options.description) {
        message += `\n\n${options.description}`;
      }

      message += `\n\n[ExaTrace: ${options.traceId}]`;

      // Commit
      await this.runGitCommand(["commit", "-m", message]);

      // Get commit SHA
      const shaResult = await this.runGitCommand([GIT_CMD_REV_PARSE, "HEAD"]);
      const sha = shaResult.output.trim();

      this.logActivity(DomainEventType.GitCommitted, {
        success: true,
        message: options.message,
        trace_id: options.traceId,
        commit_sha: sha,
        duration_ms: Date.now() - startTime,
      });

      return sha;
    } catch (error) {
      this.logActivity(DomainEventType.GitCommitted, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Checkout a branch
   */
  async checkoutBranch(
    branchName: string,
    options?: Opt<{ allowProtected?: boolean }, Reason.ExecutionConfig>,
  ): Promise<void> {
    const startTime = Date.now();

    // Security Guard: Prevent checkouts to protected branches for agents
    // Exception: allow when explicitly permitted (e.g., for creating feature branches)
    const protectedBranches: string[] = [
      GitBranchName.MAIN,
      GitBranchName.MASTER,
      GitBranchName.DEVELOP,
      GitBranchName.PROD,
      GitBranchName.PRODUCTION,
    ];
    if (
      !options?.allowProtected && protectedBranches.includes(branchName.toLowerCase()) &&
      this.identityId !== DAEMON_IDENTITY_ID
    ) {
      throw new GitSecurityError(`Switching to protected branch '${branchName}' is prohibited for agents.`);
    }

    try {
      await this.runGitCommand(["checkout", branchName]);

      this.logActivity(DomainEventType.GitCheckout, {
        success: true,
        branch: branchName,
        duration_ms: Date.now() - startTime,
      });
    } catch (error) {
      this.logActivity(DomainEventType.GitCheckout, {
        success: false,
        branch: branchName,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get the current branch name
   *
   * @returns Current branch name
   */
  async getCurrentBranch(): Promise<string> {
    const result = await this.runGitCommand([GIT_CMD_BRANCH, "--show-current"]);
    return result.output.trim();
  }

  /**
   * Get the default branch name (what HEAD points to)
   */
  async getDefaultBranch(repoPath?: Opt<string, Reason.SensibleDefault>): Promise<string> {
    const cwd = repoPath || this.repoPath || Deno.cwd();

    // Prefer local HEAD resolution (works for local repos and even for unborn branches).
    const headRef = await this.runGitCommand(
      ["-C", cwd, "symbolic-ref", "--quiet", "--short", "HEAD"],
      { throwOnError: false },
    );

    if (headRef.exitCode === 0) {
      const branch = headRef.output.trim();
      if (branch && branch !== "HEAD") return branch;
    }

    // If that fails, try "branch --show-current".
    const current = await this.runGitCommand(
      ["-C", cwd, GIT_CMD_BRANCH, "--show-current"],
      { throwOnError: false },
    );

    if (current.exitCode === 0) {
      const branch = current.output.trim();
      if (branch) return branch;
    }

    // If we still can't identify it, pick a sensible existing local branch.
    const localBranches = await this.runGitCommand(
      ["-C", cwd, "for-each-ref", "--format=%(refname:short)", "refs/heads"],
      { throwOnError: false },
    );

    if (localBranches.exitCode === 0) {
      const branches = new Set(
        localBranches.output
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      );

      if (branches.has(GitBranchName.MAIN)) return GitBranchName.MAIN;
      if (branches.has(GitBranchName.MASTER)) return GitBranchName.MASTER;

      const first = branches.values().next().value as string | undefined;
      if (first) return first;
    }

    // Default fallback
    return GitBranchName.MAIN;
  }

  /**
   * Add a git worktree at the given path, checked out at the given base branch/ref.
   *
   * Note: This does not create a feature branch; callers should create/checkout the
   * feature branch within the worktree checkout.
   */
  async addWorktree(worktreePath: string, baseBranch: string): Promise<void> {
    // Use --force to allow checking out branches that may be in use by other worktrees
    // This is safe because the execution worktree will create its own feature branch
    await this.runGitCommand([GIT_CMD_WORKTREE, GIT_CMD_ADD, worktreePath, baseBranch, "--force"]);
  }

  /**
   * Remove a git worktree.
   *
   * This is not used by Phase 37.6 yet, but is helpful for future lifecycle cleanup.
   */
  async removeWorktree(
    worktreePath: string,
    options?: Opt<{ force?: boolean }, Reason.ExecutionConfig>,
  ): Promise<void> {
    const args = [GIT_CMD_WORKTREE, GIT_CMD_REMOVE];
    if (options?.force) args.push("--force");
    args.push(worktreePath);
    await this.runGitCommand(args);
  }

  /**
   * Prune stale git worktree metadata.
   *
   * This is useful when worktree directories were deleted manually or after crashes,
   * leaving stale entries under `.git/worktrees`.
   */
  async pruneWorktrees(
    options?: Opt<
      { dryRun?: boolean; verbose?: boolean; expire?: string },
      Reason.ExecutionConfig
    >,
  ): Promise<string> {
    const args = [GIT_CMD_WORKTREE, "prune"];
    if (options?.dryRun) args.push("--dry-run");
    if (options?.verbose) args.push("--verbose");
    if (options?.expire) args.push("--expire", options.expire);

    const result = await this.runGitCommand(args);
    return result.output;
  }

  /**
   * List git worktrees for this repository.
   */
  async listWorktrees(): Promise<IWorktreeInfo[]> {
    const result = await this.runGitCommand([GIT_CMD_WORKTREE, GIT_CMD_LIST, "--porcelain"]);
    return GitService.parseWorktreeListPorcelain(result.output);
  }

  protected static parseWorktreeListPorcelain(output: string): IWorktreeInfo[] {
    const lines = output.split("\n");
    const worktrees: IWorktreeInfo[] = [];
    let current: IWorktreeInfo | null = null;

    const flush = () => {
      if (current?.path) worktrees.push(current);
      current = null;
    };

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line) continue;

      if (line.startsWith("worktree ")) {
        flush();
        current = { path: line.substring("worktree ".length) };
        continue;
      }

      if (!current) continue;

      if (line.startsWith("HEAD ")) {
        current.head = line.substring("HEAD ".length);
        continue;
      }

      if (line.startsWith("branch ")) {
        current.branch = line.substring("branch ".length);
        continue;
      }

      if (line === "detached") {
        current.detached = true;
        continue;
      }

      if (line === "locked" || line.startsWith("locked ")) {
        current.locked = true;
        continue;
      }

      if (line === "prunable" || line.startsWith("prunable ")) {
        current.prunable = true;
        continue;
      }
    }

    flush();
    return worktrees;
  }

  /**
   * Validate git command for security violations
   * @throws GitSecurityError if command violates security policies
   */
  private validateGitCommandSecurity(args: string[]): void {
    const fullCommand = args.join(" ").toLowerCase();

    // Prohibit destructive operations everywhere
    // These are the commands that can cause data loss
    const isDestructive = (fullCommand.includes("reset") && fullCommand.includes("--hard")) ||
      (fullCommand.includes("clean") && (fullCommand.includes("-f") || fullCommand.includes("-d")));

    if (isDestructive) {
      throw new GitSecurityError(`Destructive git operation prohibited: git ${args.join(" ")}`);
    }
  }

  /**
   * Validate git command arguments for security and policy compliance.
   * Checks for dangerous options, protected branch operations, and destructive commands.
   */
  validateArgs(args: string[]): { valid: boolean; reason?: string } {
    const dangerousGitOptions = [
      "--exec-path",
      "--git-dir",
      "--work-tree",
      "--namespace",
      "--config",
      "--config-env",
      "--exec",
      "--html-path",
    ];

    const fullCommand = args.join(" ").toLowerCase();

    // Prohibit destructive operations
    const isDestructive = (fullCommand.includes("reset") && fullCommand.includes("--hard")) ||
      (fullCommand.includes("clean") && (fullCommand.includes("-f") || fullCommand.includes("-d")));

    if (isDestructive) {
      return {
        valid: false,
        reason: `Destructive git operation prohibited: git ${args.join(" ")}`,
      };
    }

    // Protect system branches from direct checkout/modification
    const protectedBranches: string[] = [
      GitBranchName.MAIN,
      GitBranchName.MASTER,
      GitBranchName.DEVELOP,
      GitBranchName.PROD,
      GitBranchName.PRODUCTION,
    ];
    if (args.includes("checkout") || args.includes(GIT_CMD_BRANCH)) {
      if (args.some((arg) => protectedBranches.includes(arg.toLowerCase()))) {
        return {
          valid: false,
          reason: `Operations on protected branches (main, master, etc.) are prohibited for safety.`,
        };
      }
    }

    // Exact-match options that enable config-injection / scope-escape RCE primitives.
    const dangerousExactOptions = ["-c", "-C"];

    for (const arg of args) {
      if (dangerousExactOptions.includes(arg) || dangerousGitOptions.some((option) => arg.startsWith(option))) {
        return {
          valid: false,
          reason: `Dangerous git option not allowed: ${arg}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Error detail for a failed git command. git writes some failure messages
   * (e.g. "nothing to commit") to stdout rather than stderr, so fall back to
   * stdout when stderr is empty.
   */
  private errorDetail(errorOutput: string, output: string): string {
    return errorOutput || output;
  }

  public async runGitCommand(
    args: string[],
    options: IGitCommandOptions = {},
  ): Promise<{ output: string; exitCode: number }> {
    // Security validation
    this.validateGitCommandSecurity(args);

    const {
      throwOnError = true,
      timeoutMs = DEFAULT_GIT_COMMAND_TIMEOUT_MS,
      retryOnLock = true,
    } = options;

    const startTime = Date.now();
    let attempt = 0;
    const maxRetries = retryOnLock ? DEFAULT_GIT_MAX_RETRIES : 0;

    while (attempt <= maxRetries) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const cmd = new Deno.Command("git", {
          args,
          cwd: this.repoPath,
          stdout: "piped",
          stderr: "piped",
          signal: controller.signal,
        });

        const result = await cmd.output();
        clearTimeout(timeoutId);

        const output = new TextDecoder().decode(result.stdout);
        const errorOutput = new TextDecoder().decode(result.stderr);

        // Handle specific git error conditions
        if (result.code !== 0) {
          const gitError = this.classifyGitError(result.code, this.errorDetail(errorOutput, output), args);

          if (throwOnError) {
            throw gitError;
          }
        }

        // Log successful command
        this.logActivity(DomainEventType.GitCommandSuccess, {
          command: `git ${args.join(" ")}`,
          exit_code: result.code,
          duration_ms: Date.now() - startTime,
          attempt: attempt + 1,
        });

        return {
          output: output || errorOutput,
          exitCode: result.code,
        };
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);

        // Handle timeout
        if (error instanceof Error && error.name === "AbortError") {
          const timeoutError = new GitTimeoutError(
            `Git command timed out after ${timeoutMs}ms: git ${args.join(" ")}`,
          );

          if (throwOnError) {
            throw timeoutError;
          }

          this.logActivity("git.command.timeout", {
            command: `git ${args.join(" ")}`,
            timeout_ms: timeoutMs,
            attempt: attempt + 1,
          });

          return { output: "", exitCode: -1 };
        }

        // Handle lock conflicts with retry
        if (retryOnLock && attempt < maxRetries && this.isLockError(error as GitServiceError)) {
          attempt++;
          const delay = Math.pow(2, attempt) * DEFAULT_GIT_RETRY_BACKOFF_BASE_MS; // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        if (throwOnError) {
          throw error;
        }

        return { output: "", exitCode: -1 };
      }
    }

    throw new GitError(`Git command failed after ${maxRetries + 1} attempts: git ${args.join(" ")}`);
  }

  /**
   * Classify git errors into specific error types
   */
  public classifyGitError(exitCode: number, stderr: string, args: string[]): GitError {
    const command = args.join(" ");

    // Repository state errors
    if (stderr.includes("not a git repository")) {
      return new GitRepositoryError(`Not a git repository: ${this.repoPath}`);
    }

    if (stderr.includes("index.lock") || stderr.includes("lock")) {
      return new GitLockError(`Repository locked: ${stderr.trim()}`);
    }

    if (stderr.includes("corrupt") || stderr.includes("loose object")) {
      return new GitCorruptionError(`Repository corruption detected: ${stderr.trim()}`);
    }

    // Common command errors
    if (command.startsWith(GIT_CMD_STATUS) && exitCode === DEFAULT_GIT_EXIT_CODE_FATAL) {
      return new GitRepositoryError(`Invalid repository state: ${stderr.trim()}`);
    }

    if (command.startsWith("commit") && stderr.includes("nothing to commit")) {
      return new GitNothingToCommitError("Nothing to commit");
    }

    // Generic git error
    return new GitError(`Git command failed (${exitCode}): ${stderr.trim()}`);
  }

  /**
   * Check if error is related to repository locking
   */
  protected isLockError(error: GitServiceError): boolean {
    if (!(error instanceof Error)) return false;
    return error.message.includes("lock") || error.message.includes("Lock");
  }

  /**
   * Log activity to database
   */
  private logActivity(actionType: string, payload: Record<string, JsonValue>): void {
    if (!this.logger) return;
    void this.logger.info(actionType, null, payload, this.traceId);
  }
}
