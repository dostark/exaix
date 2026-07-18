/**
 * @module GitExecutionSetupService
 * @path packages/execution/src/git_execution_setup_service.ts
 * @description Resolves portal repo roots, base branches, and prepares the
 *   git working tree (branch checkout or portal worktree) that plan
 *   execution runs against. Extracted from ExecutionLoop.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/execution_loop.ts]
 */

import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import type { IGitService, IGitServiceFactory } from "@exaix/core/types";
import type { PlanFrontmatter } from "@exaix/schemas/plan_schema.ts";
import { PortalExecutionStrategy } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

/** Result of preparing the git working tree for plan execution. */
export interface IGitExecutionSetupResult {
  executionRoot: string;
  executionGitService: IGitService;
  baseBranch?: string;
  branchName?: string;
  worktreePath?: string;
}

/** Resolves repo roots/branches and prepares the git working tree for execution. */
export class GitExecutionSetupService {
  constructor(
    private config: Config,
    private gitServiceFactory?: Opt<IGitServiceFactory, Reason.OptionalDependency>,
  ) {}

  resolvePortalRepoRoot(frontmatter: PlanFrontmatter): string {
    if (!frontmatter.portal) return this.config.system.root;
    const portal = this.config.portals.find((p) => p.alias === frontmatter.portal);
    return portal ? portal.target_path : this.config.system.root;
  }

  getExecutionStrategy(frontmatter: PlanFrontmatter): PortalExecutionStrategy {
    if (!frontmatter.portal) return PortalExecutionStrategy.BRANCH;
    // Force WORKTREE for all portal tasks for security and isolation.
    return PortalExecutionStrategy.WORKTREE;
  }

  async resolveBaseBranch(
    frontmatter: PlanFrontmatter,
    gitService: IGitService,
    executionRoot: string,
  ): Promise<string> {
    // A configured branch (per-request target_branch or the portal's default_branch)
    // is only usable if it actually exists in the repo. The portal default_branch
    // carries a schema fallback ("main"), which a repo created on "master" (or any
    // other branch) will not have — insisting on it makes `git worktree add` fail with
    // "invalid reference". Branch creation is Exaix's machinery, resolved from repo
    // state: honor a configured branch when it exists, otherwise use the repo's own
    // default branch.
    const fromPlan = frontmatter.target_branch?.trim();
    if (fromPlan && await this.branchExists(gitService, executionRoot, fromPlan)) {
      return fromPlan;
    }

    if (frontmatter.portal) {
      const portalCfg = this.config.portals.find((p) => p.alias === frontmatter.portal);
      const fromPortal = portalCfg?.default_branch?.trim();
      if (fromPortal && await this.branchExists(gitService, executionRoot, fromPortal)) {
        return fromPortal;
      }
    }

    return await gitService.getDefaultBranch(executionRoot);
  }

  /** True when `branch` resolves to a real ref in the repo at `executionRoot`. */
  private async branchExists(
    gitService: IGitService,
    executionRoot: string,
    branch: string,
  ): Promise<boolean> {
    const result = await gitService.runGitCommand(
      ["-C", executionRoot, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
      { throwOnError: false },
    );
    return result.exitCode === 0;
  }

  async setupGitForExecution(args: {
    initGitBranch: boolean;
    hasExecutableWork: boolean;
    frontmatter: PlanFrontmatter;
    requestId: string;
    traceId: string;
    portalRepoRoot: string;
    portalGitService: IGitService;
    executionStrategy: PortalExecutionStrategy;
    createWorktreeExecutionPointer: (
      traceId: string,
      canonicalWorktreePath: string,
      pointerName: string,
    ) => Promise<void>;
  }): Promise<IGitExecutionSetupResult> {
    const executionRoot = args.portalRepoRoot;
    const executionGitService = args.portalGitService;
    if (!args.initGitBranch || !args.hasExecutableWork) {
      return { executionRoot, executionGitService };
    }

    // Security check: only initialize git if we're not in the system root,
    // or if we're specifically targeting a portal (which should have its own isolation).
    // Exception: allow git operations if repository is already initialized (has .git folder).
    if (args.portalRepoRoot === this.config.system.root && !args.frontmatter.portal) {
      // Check if git is already initialized
      try {
        await Deno.stat(`${args.portalRepoRoot}/.git`);
        // Git exists, continue with branch creation
      } catch {
        // For tasks in the system root that are not portal-assigned and have no .git,
        // skip git initialization to avoid creating a .git folder in ~/Exaix.
        return { executionRoot, executionGitService };
      }
    }

    await args.portalGitService.ensureRepository();
    await args.portalGitService.ensureIdentity();

    const baseBranch = await this.resolveBaseBranch(args.frontmatter, args.portalGitService, args.portalRepoRoot);

    if (args.frontmatter.portal && args.executionStrategy === PortalExecutionStrategy.WORKTREE) {
      return await this.setupPortalWorktreeExecution({
        portalAlias: args.frontmatter.portal,
        traceId: args.traceId,
        requestId: args.requestId,
        portalGitService: args.portalGitService,
        baseBranch,
        createWorktreeExecutionPointer: args.createWorktreeExecutionPointer,
      });
    }

    const branchName = await this.setupBranchExecution({
      portalGitService: args.portalGitService,
      baseBranch,
      requestId: args.requestId,
      traceId: args.traceId,
    });

    return { executionRoot, executionGitService, baseBranch, branchName };
  }

  private async setupBranchExecution(args: {
    portalGitService: IGitService;
    baseBranch: string;
    requestId: string;
    traceId: string;
  }): Promise<string> {
    // Checkout base branch to create feature branch from it
    // allowProtected: true because we're temporarily checking out to create a new branch
    await args.portalGitService.checkoutBranch(args.baseBranch, { allowProtected: true });
    return await args.portalGitService.createBranch({ requestId: args.requestId, traceId: args.traceId });
  }

  private buildPortalWorktreePath(portalAlias: string, traceId: string): string {
    return join(this.config.system.root, ".exa", "worktrees", portalAlias, traceId);
  }

  private async addWorktreeOrThrow(
    portalGitService: IGitService,
    worktreePath: string,
    baseBranch: string,
  ): Promise<void> {
    try {
      await portalGitService.addWorktree(worktreePath, baseBranch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to create portal worktree execution checkout (git worktree add)\n` +
          `worktree_path: ${worktreePath}\n` +
          `base_branch: ${baseBranch}\n` +
          `error: ${message}`,
      );
    }
  }

  private async setupPortalWorktreeExecution(args: {
    portalAlias: string;
    traceId: string;
    requestId: string;
    portalGitService: IGitService;
    baseBranch: string;
    createWorktreeExecutionPointer: (
      traceId: string,
      canonicalWorktreePath: string,
      pointerName: string,
    ) => Promise<void>;
  }): Promise<{
    executionRoot: string;
    executionGitService: IGitService;
    baseBranch: string;
    branchName: string;
    worktreePath: string;
  }> {
    const worktreePath = this.buildPortalWorktreePath(args.portalAlias, args.traceId);
    await Deno.mkdir(join(this.config.system.root, ".exa", "worktrees", args.portalAlias), { recursive: true });
    await args.createWorktreeExecutionPointer(args.traceId, worktreePath, PortalExecutionStrategy.WORKTREE);
    await this.addWorktreeOrThrow(args.portalGitService, worktreePath, args.baseBranch);

    const executionRoot = worktreePath;
    const executionGitService = this.gitServiceFactory?.createGitService(executionRoot, args.traceId) ??
      missingFactory("gitServiceFactory", "git operations");
    await executionGitService.ensureIdentity();

    const branchName = await executionGitService.createBranch({ requestId: args.requestId, traceId: args.traceId });
    return {
      executionRoot,
      executionGitService,
      baseBranch: args.baseBranch,
      branchName,
      worktreePath,
    };
  }

  async commitChanges(
    gitService: IGitService,
    requestId: string,
    traceId: string,
    identityId: string,
    onNoChanges: (traceId: string, requestId: string) => void,
  ): Promise<string | null> {
    try {
      return await gitService.commit({
        message: `Execute plan: ${requestId}`,
        description: `Executed by agent ${identityId}`,
        traceId,
      });
    } catch (error) {
      // If no changes to commit, that's actually a success (nothing needed to be done)
      if (error instanceof Error && error.message.includes("nothing to commit")) {
        onNoChanges(traceId, requestId);
        return null;
      } else {
        throw error;
      }
    }
  }
}

function missingFactory(name: string, context: string): never {
  throw new Error(
    `GitExecutionSetupService: ${name} factory is required for ${context}. Provide \`${name}\` in IExecutionLoopConfig.`,
  );
}
