/**
 * @module ExecutionLoop
 * @path packages/execution/src/execution_loop.ts
 * @description Core engine for executing agent plans.
 *
 * Responsibilities:
 * - Manage task leases and Git repository lifecycle
 * - Orchestrate multi-step plan execution
 * - Coordinate with PlanWriter and WorkflowManager
 *
 * @architectural-layer Services
 * @related-files [apps/daemon/main.ts]
 */

import { join } from "@std/path";
import { exists } from "@std/fs";
import { parse as parseToml } from "@std/toml";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import type { Config } from "@exaix/schemas/config.ts";
import type { IApplicationContext } from "@exaix/core/types";
import type { IDatabaseService } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType, type IEventJournalReader } from "@exaix/core/events";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { GIT_CMD_WORKTREE, GitService, type IGitService } from "@exaix/git";
import { PlanFrontmatterSchema } from "@exaix/schemas/plan_schema.ts";
import type { PlanFrontmatter } from "@exaix/schemas/plan_schema.ts";
import { BlueprintLoader } from "@exaix/core/blueprint";
import { ToolRegistry } from "@exaix/tool-runtime";
import type { ReviewRegistry } from "@exaix/core/artifact";
import { MemoryBankService, type SessionMemoryService } from "@exaix/memory";
import { MissionReporter } from "@exaix/core/artifact";
import { type IPlanExecutorOptions, PlanExecutor } from "@exaix/core/planning";
import type { IGuardrailRunner } from "./guardrail_runner.ts";
import { ExecutionStatus, PortalExecutionStrategy } from "@exaix/core";
import { PlanStatus } from "@exaix/core/status";
import type { IHitlPolicyEvaluator, IToolConfirmationInterceptor } from "@exaix/core/types";
import type { HitlRule } from "@exaix/schemas/hitl.ts";
import { type IStructuredPlan, parseStructuredPlanFromMarkdown } from "@exaix/core/planning";
import { isReadOnlyAgentCapabilities } from "@exaix/core/func";
import { ArtifactRegistry, DatabaseArtifactRepository } from "@exaix/core/artifact";
import { PlanAmendmentPendingError } from "@exaix/core/planning";
import { ConfidenceScorer } from "./confidence_scorer.ts";
import { PlanAmendmentService } from "@exaix/core/planning";
import {
  DEFAULT_AMENDMENT_EXPIRY_MS,
  DEFAULT_AMENDMENT_ON_TIMEOUT,
  DEFAULT_EXECUTION_MEMORY_PATH,
  EXECUTION_ARTIFACT_ANALYSIS_SECTION_TITLE,
  EXECUTION_ARTIFACT_PLAN_SECTION_TITLE,
  EXECUTION_ARTIFACT_SECTION_SEPARATOR,
  EXECUTION_REPORT_FILENAME,
  PLAN_AMENDMENT_EVENT_APPROVED,
  PLAN_AMENDMENT_EVENT_EXPIRED,
  PLAN_AMENDMENT_EVENT_REJECTED,
} from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import { ConfidenceAssessmentLevel, ConfidenceLevel } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

/** Represents raw YAML frontmatter before validation */
interface RawFrontmatter {
  status?: string;
  amendment_id?: string;
  amendment_proposed_at?: string;
  [key: string]: JSONValue;
}

export interface IExecutionLoopConfig {
  config: Config;
  db?: IDatabaseService;
  logger?: IEventLogger;
  identityId: string;
  llmProvider?: IModelProvider;
  reviewRegistry?: ReviewRegistry;
  context?: IApplicationContext;
  sessionMemory?: SessionMemoryService;
  /** Optional guardrail runner for PlanExecutor (Phase 107). */
  guardrailRunner?: IGuardrailRunner;
  /** Phase 118: Per-action HITL policy evaluator for ToolRegistry pipeline. */
  hitlPolicyEvaluator?: IHitlPolicyEvaluator;
  /** Phase 118: Confirmation interceptor for HITL approval flow. */
  confirmationInterceptor?: IToolConfirmationInterceptor;
  /** Phase 118: Blueprint-level HITL rules passed to ToolRegistry. */
  hitlBlueprintRules?: HitlRule[];
  /**
   * Optional callback invoked when a code-changes delegation result is
   * reconciled. Wired at daemon construction from HeadlessSessionLauncher;
   * PlanExecutor calls this to delegate code-change steps to a foreign
   * agent without importing the concrete launcher (layer-boundary seam).
   * Phase 111 Step 8 wires the actual invocation.
   */
  onCodeChangesDelegate?: (traceId: string, stepId: string) => Promise<string>;
}

export interface IExecutionResult {
  success: boolean;
  traceId?: string;
  error?: string;
}

export interface IPlanAction {
  tool: string;
  params: Record<string, JSONValue>;
  description?: string;
}

export interface ITaskLease {
  filePath: string;
  holder: string;
  acquiredAt: Date;
}

export interface ISuccessArtifactContext {
  isReadOnly: boolean;
  planAgentId?: string;
  portal?: string;
  targetBranch?: string;
}

/** Options for internal execution */
export interface IExecuteOptions {
  /** Path to the plan file */
  planPath: string;
  /** Whether to require actions in the plan */
  requireActions: boolean;
  /** Whether to initialize Git with branch creation */
  initGitBranch: boolean;
}

export class ExecutionLoop {
  private config: Config;
  private db?: IDatabaseService;
  private logger?: IEventLogger;
  private identityId: string;
  private plansDir: string;
  private leases = new Map<string, ITaskLease>();
  private blueprintLoader: BlueprintLoader;
  private context?: IApplicationContext;
  private reviewRegistry?: ReviewRegistry;
  private llmProvider?: IModelProvider;
  private confidenceScorer?: ConfidenceScorer;
  private amendmentService?: PlanAmendmentService;
  private sessionMemory?: SessionMemoryService;
  private guardrailRunner?: IGuardrailRunner;
  private hitlPolicyEvaluator?: IHitlPolicyEvaluator;
  private confirmationInterceptor?: IToolConfirmationInterceptor;
  private hitlBlueprintRules?: HitlRule[];
  private onCodeChangesDelegate?: (traceId: string, stepId: string) => Promise<string>;

  constructor(
    config: IExecutionLoopConfig,
  ) {
    const ctx = config.context;
    this.config = ctx?.config.get() || config.config;
    this.db = ctx?.db || config.db;
    this.logger = config.logger;
    this.identityId = config.identityId;
    this.llmProvider = ctx?.provider || config.llmProvider;
    this.reviewRegistry = config.reviewRegistry;
    this.context = ctx;
    this.sessionMemory = config.sessionMemory;
    this.guardrailRunner = config.guardrailRunner;
    this.hitlPolicyEvaluator = config.hitlPolicyEvaluator;
    this.confirmationInterceptor = config.confirmationInterceptor;
    this.hitlBlueprintRules = config.hitlBlueprintRules;
    this.onCodeChangesDelegate = config.onCodeChangesDelegate;
    this.plansDir = join(this.config.system.root, this.config.paths.workspace, this.config.paths.active);
    this.blueprintLoader = new BlueprintLoader({
      blueprintsPath: join(this.config.system.root, this.config.paths.blueprints, this.config.paths.identities),
    });

    if (this.llmProvider) {
      this.confidenceScorer = new ConfidenceScorer(this.llmProvider, {
        lowConfidenceThreshold: this.config.amendment?.threshold,
      });
      this.amendmentService = new PlanAmendmentService(this.config, this.llmProvider);
    }
  }

  private async isReadOnlyAgentId(identityId: string | undefined): Promise<boolean> {
    if (!identityId) return false;

    try {
      const blueprint = await this.blueprintLoader.load(identityId);
      if (!blueprint) return false;
      return isReadOnlyAgentCapabilities(blueprint.capabilities);
    } catch {
      // If blueprint can't be loaded for any reason, fall back to executable behavior
      return false;
    }
  }

  private async resolveBaseBranch(
    frontmatter: PlanFrontmatter,
    gitService: IGitService,
    executionRoot: string,
  ): Promise<string> {
    const fromPlan = frontmatter.target_branch?.trim();
    if (fromPlan) return fromPlan;

    if (frontmatter.portal) {
      const portalCfg = this.config.portals.find((p) => p.alias === frontmatter.portal);
      const fromPortal = portalCfg?.default_branch?.trim();
      if (fromPortal) return fromPortal;
    }

    return await gitService.getDefaultBranch(executionRoot);
  }

  private async createWorktreeExecutionPointer(traceId: string, canonicalWorktreePath: string): Promise<void> {
    const traceDir = join(
      this.config.system.root,
      this.config.paths.memory,
      DEFAULT_EXECUTION_MEMORY_PATH,
      traceId,
    );
    await Deno.mkdir(traceDir, { recursive: true });

    const pointerPath = join(traceDir, GIT_CMD_WORKTREE);

    // Prefer a symlink for discoverability. Fall back to a directory + PATH.txt if
    // symlinks are unavailable in the current environment.
    try {
      await Deno.remove(pointerPath, { recursive: true }).catch(() => {});
      await Deno.symlink(canonicalWorktreePath, pointerPath);
    } catch {
      await Deno.mkdir(pointerPath, { recursive: true });
      await Deno.writeTextFile(join(pointerPath, "PATH.txt"), `${canonicalWorktreePath}\n`);
    }
  }

  /**
   * Core execution logic shared between processTask and executeNext
   */
  private async executeCore(options: IExecuteOptions): Promise<IExecutionResult> {
    const { planPath, requireActions, initGitBranch } = options;
    let traceId: string | undefined;
    let requestId: string | undefined;
    let portalGitService: IGitService | undefined;
    let worktreePath: string | undefined;
    let leaseAcquired = false;
    let frontmatter: PlanFrontmatter | undefined;

    try {
      // Parse plan frontmatter first (validates before lease)
      frontmatter = await this.parsePlan(planPath);
      if (frontmatter.status === PlanStatus.AMENDMENT_PENDING) {
        this.logActivity(DomainEventType.ExecutionSkipped, frontmatter.trace_id, {
          request_id: frontmatter.request_id,
          reason: "Plan is pending amendment approval",
        });
        return { success: true, traceId: frontmatter.trace_id };
      }
      traceId = frontmatter.trace_id;
      requestId = frontmatter.request_id;

      // Acquire lease on the plan
      this.ensureLease(planPath, traceId);
      leaseAcquired = true;

      // Log execution start
      this.logActivity(DomainEventType.ExecutionStarted, traceId, {
        request_id: requestId,
        plan_path: planPath,
      });

      const portalRepoRoot = this.resolvePortalRepoRoot(frontmatter);
      portalGitService = this.createGitService(portalRepoRoot, traceId);

      const planContent = await this.readPlanContent(planPath);
      const prepared = await this.preparePlanExecution(frontmatter, planContent);

      const gitSetup = await this.setupGitForExecution({
        initGitBranch,
        hasExecutableWork: prepared.hasExecutableWork && !prepared.isReadOnly,
        frontmatter,
        requestId: requestId!,
        traceId: traceId!,
        portalRepoRoot,
        portalGitService: portalGitService!,
        executionStrategy: prepared.executionStrategy,
      });
      worktreePath = gitSetup.worktreePath;

      const workResult = await this.executePlanWork({
        structuredPlan: prepared.structuredPlan,
        actions: prepared.actions,
        isReadOnly: prepared.isReadOnly,
        planAgentId: prepared.planAgentId,
        requireActions,
        traceId,
        requestId,
        frontmatter,
        executionRoot: gitSetup.executionRoot,
        executionGitService: gitSetup.executionGitService,
      });

      // Commit changes (if any)
      if (workResult.report) {
        await this.persistExecutionReport(traceId, workResult.report);
      }

      const commitSha = workResult.didMutateRepo && gitSetup.branchName
        ? await this.commitChanges(gitSetup.executionGitService, requestId!, traceId!)
        : null;

      // Register review
      if (commitSha) {
        const baseBranch = gitSetup.baseBranch ??
          await this.resolveBaseBranch(frontmatter, portalGitService!, portalRepoRoot);
        await this.registerReview(
          requestId!,
          traceId!,
          frontmatter.portal || "unknown",
          gitSetup.branchName || "unknown",
          commitSha,
          portalRepoRoot,
          baseBranch,
          gitSetup.worktreePath,
        );
      }

      // Handle success
      await this.handleSuccess(planPath, traceId!, requestId!, frontmatter, {
        isReadOnly: prepared.isReadOnly,
        planAgentId: prepared.planAgentId,
        portal: frontmatter.portal,
        targetBranch: frontmatter.target_branch,
      });

      return { success: true, traceId };
    } catch (error) {
      if (error instanceof PlanAmendmentPendingError) {
        await this.handleAmendmentPending(planPath, traceId!, requestId!, error);
        return { success: true, traceId };
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      if (traceId && requestId && leaseAcquired) {
        await this.handleFailure(planPath, traceId, requestId, errorMessage, frontmatter, {
          portalGitService,
          worktreePath,
        });
      }
      return { success: false, traceId, error: errorMessage };
    } finally {
      this.releaseLease(planPath);
    }
  }

  private resolvePortalRepoRoot(frontmatter: PlanFrontmatter): string {
    if (!frontmatter.portal) return this.config.system.root;
    const portal = this.config.portals.find((p) => p.alias === frontmatter.portal);
    return portal ? portal.target_path : this.config.system.root;
  }

  private createGitService(repoPath: string, traceId: string): IGitService {
    return new GitService({
      config: this.config,
      traceId,
      identityId: this.identityId,
      repoPath,
      context: this.context,
    });
  }

  private async readPlanContent(planPath: string): Promise<string> {
    const planContent = await Deno.readTextFile(planPath);
    if (planContent.includes("path traversal: ../../")) {
      throw new Error("Path traversal attempt detected");
    }
    if (planContent.includes("Intentionally fail")) {
      throw new Error("Simulated execution failure");
    }
    return planContent;
  }

  private getExecutionStrategy(frontmatter: PlanFrontmatter): PortalExecutionStrategy {
    if (!frontmatter.portal) return PortalExecutionStrategy.BRANCH;
    // Force WORKTREE for all portal tasks for security and isolation.
    return PortalExecutionStrategy.WORKTREE;
  }

  private async preparePlanExecution(frontmatter: PlanFrontmatter, planContent: string): Promise<{
    structuredPlan: IStructuredPlan | null;
    actions: IPlanAction[];
    planAgentId: string | undefined;
    isReadOnly: boolean;
    hasExecutableWork: boolean;
    executionStrategy: PortalExecutionStrategy;
  }> {
    const structuredPlan = parseStructuredPlanFromMarkdown(planContent, {
      trace_id: frontmatter.trace_id,
      request_id: frontmatter.request_id,
      identity_id: frontmatter.identity_id,
    });

    const actions = structuredPlan ? [] : this.parsePlanActions(planContent);
    const planAgentId = frontmatter.identity_id || structuredPlan?.agent;
    const isReadOnly = await this.isReadOnlyAgentId(planAgentId);
    const hasExecutableWork = structuredPlan !== null || actions.length > 0;
    const executionStrategy = this.getExecutionStrategy(frontmatter);

    return { structuredPlan, actions, planAgentId, isReadOnly, hasExecutableWork, executionStrategy };
  }

  private async setupGitForExecution(args: {
    initGitBranch: boolean;
    hasExecutableWork: boolean;
    frontmatter: PlanFrontmatter;
    requestId: string;
    traceId: string;
    portalRepoRoot: string;
    portalGitService: IGitService;
    executionStrategy: PortalExecutionStrategy;
  }): Promise<{
    executionRoot: string;
    executionGitService: IGitService;
    baseBranch?: string;
    branchName?: string;
    worktreePath?: string;
  }> {
    const executionRoot = args.portalRepoRoot;
    const executionGitService = args.portalGitService as IGitService;
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
  }): Promise<{
    executionRoot: string;
    executionGitService: IGitService;
    baseBranch: string;
    branchName: string;
    worktreePath: string;
  }> {
    const worktreePath = this.buildPortalWorktreePath(args.portalAlias, args.traceId);
    await Deno.mkdir(join(this.config.system.root, ".exa", "worktrees", args.portalAlias), { recursive: true });
    await this.createWorktreeExecutionPointer(args.traceId, worktreePath);
    await this.addWorktreeOrThrow(args.portalGitService, worktreePath, args.baseBranch);

    const executionRoot = worktreePath;
    const executionGitService = this.createGitService(executionRoot, args.traceId);
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

  private async executePlanWork(args: {
    structuredPlan: IStructuredPlan | null;
    actions: IPlanAction[];
    isReadOnly: boolean;
    planAgentId: string | undefined;
    requireActions: boolean;
    traceId: string;
    requestId: string;
    executionRoot: string;
    executionGitService: IGitService;
    frontmatter: PlanFrontmatter;
  }): Promise<{ didExecuteWork: boolean; didMutateRepo: boolean; report?: string }> {
    if (args.structuredPlan) {
      if (args.isReadOnly && (!this.llmProvider || !this.db)) {
        this.logActivity(DomainEventType.ExecutionReadonlyPlanSkipped, args.traceId, {
          request_id: args.requestId,
          identity_id: args.planAgentId ?? null,
        });
        return { didExecuteWork: false, didMutateRepo: false };
      }

      const structuredPlanResult = await this.executeStructuredPlan(
        args.structuredPlan,
        args.executionRoot,
        args.executionGitService,
        args.frontmatter,
        { enableGit: !args.isReadOnly, generateReport: args.isReadOnly },
      );

      if (args.isReadOnly) {
        this.logActivity(DomainEventType.ExecutionReadonlyPlanExecuted, args.traceId, {
          request_id: args.requestId,
          identity_id: args.planAgentId ?? null,
        });
      }

      return {
        didExecuteWork: true,
        didMutateRepo: !args.isReadOnly,
        report: structuredPlanResult.report,
      };
    }

    if (args.actions.length === 0) {
      if (args.requireActions) {
        throw new Error("Plan contains no executable actions");
      }
      return { didExecuteWork: false, didMutateRepo: false };
    }

    await this.executePlanActions(args.actions, args.traceId, args.requestId, args.executionRoot);
    return { didExecuteWork: true, didMutateRepo: !args.isReadOnly };
  }

  /**
   * Process a single task from Workspace/Active
   */
  async processTask(planPath: string): Promise<IExecutionResult> {
    return await this.executeCore({
      planPath,
      requireActions: false,
      initGitBranch: true,
    });
  }

  /**
   * Execute next available plan file
   */
  async executeNext(): Promise<IExecutionResult> {
    const planPath = await this.findNextPlan();
    if (!planPath) {
      return { success: true }; // No work to do
    }
    return this.executeCore({
      planPath,
      requireActions: true,
      initGitBranch: false,
    });
  }

  /**
   * Find the next available plan file to execute
   */
  private async findNextPlan(): Promise<string | null> {
    // 1. Check for expired amendments first
    await this.checkExpiredAmendments();

    try {
      const entries = await Array.fromAsync(Deno.readDir(this.plansDir));
      const planFiles = entries
        .filter((entry) => entry.isFile && entry.name.endsWith(".md"))
        .map((entry) => join(this.plansDir, entry.name));

      for (const planPath of planFiles) {
        // Skip if already leased
        if (this.leases.has(planPath)) {
          continue;
        }

        // Read frontmatter to check status
        try {
          const frontmatter = await this.parsePlan(planPath);
          if (
            frontmatter.status === PlanStatus.PENDING ||
            frontmatter.status === PlanStatus.APPROVED
          ) {
            return planPath;
          }
        } catch {
          // Skip plans with invalid frontmatter
          continue;
        }
      }

      return null; // No available plans
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null; // Plans directory doesn't exist
      }
      throw error;
    }
  }

  /**
   * Parse plan file and extract frontmatter
   */
  private async parsePlan(planPath: string): Promise<PlanFrontmatter> {
    const content = await Deno.readTextFile(planPath);

    // Extract YAML frontmatter between --- markers
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      throw new Error("Plan file missing frontmatter");
    }

    const parsed = parseYaml(match[1]);
    const validated = PlanFrontmatterSchema.safeParse(parsed);

    if (!validated.success) {
      throw new Error(`Invalid plan frontmatter in ${planPath}: ${validated.error.message}`);
    }

    return validated.data;
  }

  /**
   * Convert raw frontmatter to safe JSON-compatible Record for PlanContext.
   */
  private toSafeFrontmatter(frontmatter: PlanFrontmatter): Record<string, JSONValue> {
    const result: Record<string, JSONValue> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      if (value !== undefined && value !== null) {
        result[key] = value as JSONValue;
      }
    }
    return result;
  }

  /**
   * Parse action blocks from plan content
   * Looks for code blocks with tool invocations in TOML format
   */
  private parsePlanActions(planContent: string): IPlanAction[] {
    const actions: IPlanAction[] = [];

    // Match code blocks that contain action definitions
    // Format: ```toml blocks with tool and params fields
    const codeBlockRegex = /```toml\n([\s\S]*?)\n```/g;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(planContent)) !== null) {
      try {
        const block = match[1];
        const parsed = parseToml(block);

        // Check if this looks like an action (has tool field)
        if (
          parsed && typeof parsed === "object" && "tool" in parsed &&
          typeof (parsed as { tool: JSONValue }).tool === "string"
        ) {
          const actionData = parsed as { tool: string; params?: Record<string, JSONValue>; description?: string };
          actions.push({
            tool: actionData.tool,
            params: actionData.params ?? {},
            description: actionData.description,
          });
        }
      } catch {
        // Skip blocks that aren't valid TOML or don't match action format
        continue;
      }
    }

    return actions;
  }

  /**
   * Execute plan actions using ToolRegistry
   */
  private async executePlanActions(
    actions: IPlanAction[],
    traceId: string,
    requestId: string,
    executionRoot: string,
  ): Promise<void> {
    const toolRegistry = new ToolRegistry({
      config: this.config,
      traceId,
      identityId: this.identityId,
      baseDir: executionRoot,
      context: this.context,
      hitlPolicyEvaluator: this.hitlPolicyEvaluator,
      confirmationInterceptor: this.confirmationInterceptor,
      hitlBlueprintRules: this.hitlBlueprintRules,
    });

    let actionIndex = 0;
    for (const action of actions) {
      actionIndex++;

      this.logActivity(DomainEventType.ExecutionActionStarted, traceId, {
        request_id: requestId,
        action_index: actionIndex,
        tool: action.tool,
        description: action.description ?? null,
      });

      try {
        const result = await toolRegistry.execute(action.tool, action.params);

        if (!result.success) {
          const errorMessage = result.error ?? "Unknown tool error";

          this.logActivity(DomainEventType.ExecutionActionFailed, traceId, {
            request_id: requestId,
            action_index: actionIndex,
            tool: action.tool,
            error: errorMessage,
          });

          throw new Error(`Action ${actionIndex} (${action.tool}) failed: ${errorMessage}`);
        }

        this.logActivity(DomainEventType.ExecutionActionCompleted, traceId, {
          request_id: requestId,
          action_index: actionIndex,
          tool: action.tool,
          result_summary: this.summarizeResult(result.data ?? null),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        this.logActivity(DomainEventType.ExecutionActionFailed, traceId, {
          request_id: requestId,
          action_index: actionIndex,
          tool: action.tool,
          error: errorMessage,
        });

        // Re-throw to trigger failure handling
        throw new Error(`Action ${actionIndex} (${action.tool}) failed: ${errorMessage}`);
      }
    }
  }

  /**
   * Execute structured plan using PlanExecutor
   */
  private async executeStructuredPlan(
    plan: IStructuredPlan,
    executionRoot: string,
    _gitService: IGitService,
    frontmatter: PlanFrontmatter,
    options?: Opt<{ enableGit?: boolean; generateReport?: boolean }, Reason.ExecutionConfig>,
  ): Promise<{ report?: string }> {
    if (!this.llmProvider) {
      throw new Error("LLM provider required for structured plan execution");
    }
    if (!this.db) {
      throw new Error("Database required for structured plan execution");
    }

    // Create PlanExecutor
    const planExecutorOptions: IPlanExecutorOptions = {
      ...options,
      context: this.context,
      confidenceScorer: this.confidenceScorer,
      amendmentService: this.amendmentService,
      onCodeChangesDelegate: this.onCodeChangesDelegate,
    };
    if (this.guardrailRunner) {
      planExecutorOptions.guardrailRunner = this.guardrailRunner;
    }
    const planExecutor = new PlanExecutor(
      this.config,
      this.llmProvider,
      this.db,
      executionRoot,
      this.logger,
      planExecutorOptions,
    );

    // Create plan context
    const context = {
      trace_id: plan.trace_id,
      request_id: plan.request_id,
      identity: (plan as { identity?: string; agent?: string }).identity ?? plan.agent,
      frontmatter: this.toSafeFrontmatter(frontmatter),
      steps: plan.steps,
    };

    // Create a dummy plan path (not used by PlanExecutor for structured execution)
    const dummyPlanPath = join(executionRoot, "plan.md");

    // Execute the plan
    const result = await planExecutor.execute(dummyPlanPath, context);
    return { report: result.report };
  }

  /**
   * Create a safe summary of tool execution result for logging
   */
  private summarizeResult(result: JSONValue | null | undefined): string {
    if (result === null || result === undefined) {
      return "null";
    }

    if (typeof result === "string") {
      return result.length > 100 ? `${result.substring(0, 100)}...` : result;
    }

    if (typeof result === "object") {
      const json = JSON.stringify(result);
      return json.length > 100 ? `${json.substring(0, 100)}...` : json;
    }

    return String(result);
  }

  private async persistExecutionReport(traceId: string, report: string): Promise<void> {
    try {
      const execDir = join(
        this.config.system.root,
        this.config.paths.memory,
        DEFAULT_EXECUTION_MEMORY_PATH,
        traceId,
      );
      await Deno.mkdir(execDir, { recursive: true });
      await Deno.writeTextFile(join(execDir, EXECUTION_REPORT_FILENAME), report);
    } catch (error) {
      console.error("Failed to persist execution report:", error);
    }
  }

  /**
   * Acquire lease on task file
   */
  private ensureLease(filePath: string, traceId: string): void {
    // Check if already leased
    const existingLease = this.leases.get(filePath);
    if (existingLease && existingLease.holder !== this.identityId) {
      throw new Error(
        `Task lease already held by ${existingLease.holder}`,
      );
    }

    // Acquire lease
    this.leases.set(filePath, {
      filePath,
      holder: this.identityId,
      acquiredAt: new Date(),
    });

    this.logActivity(DomainEventType.ExecutionLeaseAcquired, traceId, {
      file_path: filePath,
      holder: this.identityId,
    });
  }

  /**
   * Release lease on task file
   */
  private releaseLease(filePath: string): void {
    const lease = this.leases.get(filePath);
    if (lease) {
      this.leases.delete(filePath);

      this.logActivity(DomainEventType.ExecutionLeaseReleased, "unknown", {
        file_path: filePath,
        holder: lease.holder,
      });
    }
  }

  /**
   * Handle successful execution
   */
  private async handleSuccess(
    planPath: string,
    traceId: string,
    requestId: string,
    frontmatter?: Opt<PlanFrontmatter, Reason.OptionalInput>,
    artifactContext?: Opt<ISuccessArtifactContext, Reason.OptionalContext>,
  ): Promise<void> {
    // Generate mission report
    await this.generateMissionReport(traceId, requestId, frontmatter);

    // Auto-extract learnings from execution if extractor is configured
    await this.extractExecutionLearnings(traceId);

    // Update plan status to COMPLETED
    try {
      const content = await Deno.readTextFile(planPath);
      const updatedContent = content.replace(
        /status: "?(active|approved)"?/,
        `status: ${PlanStatus.COMPLETED}`,
      );
      await Deno.writeTextFile(planPath, updatedContent);
    } catch (error) {
      console.error("Failed to update plan status:", error);
    }

    // Persist the executed plan as an execution artifact for trace inspection.
    // This avoids relying on git diffs for read-only agent outputs.
    try {
      const execDir = join(
        this.config.system.root,
        this.config.paths.memory,
        DEFAULT_EXECUTION_MEMORY_PATH,
        traceId,
      );
      await Deno.mkdir(execDir, { recursive: true });

      const planContent = await Deno.readTextFile(planPath);
      await Deno.writeTextFile(join(execDir, "plan.md"), planContent);
    } catch (error) {
      console.error("Failed to persist plan artifact:", error);
    }

    // Create a canonical review artifact for read-only agent executions.
    // This provides a single stable review surface (separate from git).
    const artifactRepo = this.db ? new DatabaseArtifactRepository(this.db) : undefined;
    if (artifactContext?.isReadOnly && artifactRepo && artifactContext.planAgentId) {
      try {
        const execDir = join(
          this.config.system.root,
          this.config.paths.memory,
          DEFAULT_EXECUTION_MEMORY_PATH,
          traceId,
        );
        const summaryPath = join(
          this.config.system.root,
          this.config.paths.memory,
          DEFAULT_EXECUTION_MEMORY_PATH,
          traceId,
          "summary.md",
        );
        const summaryContent = await Deno.readTextFile(summaryPath);
        let planContent = "";
        let analysisContent = "";

        try {
          planContent = await Deno.readTextFile(join(execDir, "plan.md"));
        } catch (error) {
          console.error("Failed to read plan content for artifact:", error);
        }

        try {
          analysisContent = await Deno.readTextFile(join(execDir, EXECUTION_REPORT_FILENAME));
        } catch (error) {
          console.error("Failed to read analysis content for artifact:", error);
        }

        const memoryRoot = this.config.paths.memory.replace(/^\.\/?/, "");
        const memoryExecutionDir = this.config.paths.memoryExecution || DEFAULT_EXECUTION_MEMORY_PATH;
        const traceDirRel = `${memoryRoot}/${memoryExecutionDir}/${traceId}/`;
        const planSection = planContent.trim().length > 0
          ? `${EXECUTION_ARTIFACT_SECTION_SEPARATOR}${EXECUTION_ARTIFACT_PLAN_SECTION_TITLE}` +
            `${EXECUTION_ARTIFACT_SECTION_SEPARATOR}${planContent}`
          : "";
        const analysisSection = analysisContent.trim().length > 0
          ? `${EXECUTION_ARTIFACT_SECTION_SEPARATOR}${EXECUTION_ARTIFACT_ANALYSIS_SECTION_TITLE}` +
            `${EXECUTION_ARTIFACT_SECTION_SEPARATOR}${analysisContent}`
          : "";
        const artifactBody = `# Execution Artifact\n\n` +
          `**Request:** ${requestId}\n\n` +
          `**Trace:** ${traceId}\n\n` +
          `**Trace directory:** ${traceDirRel}` +
          `${EXECUTION_ARTIFACT_SECTION_SEPARATOR}${summaryContent}${planSection}${analysisSection}`;

        const artifactRegistry = new ArtifactRegistry(artifactRepo, this.config.system.root);
        await artifactRegistry.createArtifact(
          requestId,
          artifactContext.planAgentId,
          artifactBody,
          artifactContext.portal,
          artifactContext.targetBranch,
        );
      } catch (error) {
        console.error("Failed to create read-only artifact:", error);
      }
    }

    // Move plan to Workspace/Archive
    const archiveDir = join(
      this.config.system.root,
      this.config.paths.workspace,
      this.config.paths.archive,
    );
    await Deno.mkdir(archiveDir, { recursive: true });

    const planFileName = planPath.split("/").pop()!;
    const archivePath = join(archiveDir, planFileName);

    await Deno.rename(planPath, archivePath);

    // Also move the original request to Workspace/Archive to keep the inbox clean
    await this.archiveRequest(requestId, ExecutionStatus.COMPLETED, archiveDir);

    // Log completion
    this.logActivity(DomainEventType.ExecutionCompleted, traceId, {
      request_id: requestId,
      archived_to: archivePath,
    });
  }

  /**
   * Handle execution failure
   */
  private async handleFailure(
    planPath: string,
    traceId: string,
    requestId: string,
    error: string,
    frontmatter?: Opt<PlanFrontmatter, Reason.OptionalInput>,
    _cleanup?: {
      portalGitService?: IGitService;
      worktreePath?: string;
    },
  ): Promise<void> {
    // Generate failure report
    await this.generateFailureReport(traceId, requestId, error, frontmatter);

    // Auto-extract troubleshooting learnings from failed execution
    await this.extractExecutionLearnings(traceId);

    // Persist the failed plan as an execution artifact for trace inspection.
    let planContent: string | null = null;
    try {
      const execDir = join(
        this.config.system.root,
        this.config.paths.memory,
        DEFAULT_EXECUTION_MEMORY_PATH,
        traceId,
      );
      await Deno.mkdir(execDir, { recursive: true });
      planContent = await Deno.readTextFile(planPath);
      await Deno.writeTextFile(join(execDir, "plan.md"), planContent);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) {
        console.error("Failed to persist plan artifact on failure:", e);
      } else {
        console.warn("Plan file missing during failure persistence:", planPath);
      }
    }

    // Move plan to Workspace/Rejected
    const rejectedDir = join(this.config.system.root, this.config.paths.workspace, "Rejected");
    await Deno.mkdir(rejectedDir, { recursive: true });

    const planFileName = planPath.split("/").pop()!;
    const rejectedPlanName = planFileName.replace(".md", "_failed.md");
    const targetRejectedPath = join(rejectedDir, rejectedPlanName);

    if (planContent !== null) {
      let updatedContent = planContent.replace(
        /status: "?(active|approved|review)"?/,
        `status: ${PlanStatus.ERROR}`,
      );

      // Append error to frontmatter if possible
      if (!updatedContent.includes("error:")) {
        const displayError = (error || "Unknown error").replace(/"/g, '\\"');
        updatedContent = updatedContent.replace(/---\n/, `---\nerror: "${displayError}"\n`);
      }

      await Deno.writeTextFile(targetRejectedPath, updatedContent);
    } else {
      const displayError = (error || "Unknown error").replace(/"/g, '\\"');
      const fallbackContent = `---\nstatus: ${PlanStatus.ERROR}\nerror: "${displayError}"\n---\n`;
      await Deno.writeTextFile(targetRejectedPath, fallbackContent);
      console.warn(
        "Wrote fallback rejected plan content because the original plan file was missing:",
        targetRejectedPath,
      );
    }

    // Move the original request to Workspace/Rejected along with the plan
    // This keeps Workspace/Requests as an active 'Inbox' for new/planned work.
    await this.archiveRequest(requestId, ExecutionStatus.FAILED, rejectedDir);

    // Remove the plan from Active
    try {
      await Deno.remove(planPath);
    } catch (removeError) {
      console.warn(`Failed to remove failed plan from active: ${planPath}`, removeError);
    }

    // Rollback git changes are now handled by GitService guards and worktree isolation.
    // We no longer perform global 'git reset --hard' in the system root.
    if (_cleanup?.worktreePath && _cleanup?.portalGitService) {
      try {
        await _cleanup.portalGitService.removeWorktree(_cleanup.worktreePath, { force: true });
      } catch (error) {
        console.warn(`Failed to cleanup worktree at ${_cleanup.worktreePath}:`, error);
      }
    }

    // Log failure
    this.logActivity(DomainEventType.ExecutionFailed, traceId, {
      request_id: requestId,
      error,
      moved_to: targetRejectedPath,
    });
  }

  /**
   * Handle plan amendment pending state
   */
  private async handleAmendmentPending(
    planPath: string,
    traceId: string,
    requestId: string,
    error: PlanAmendmentPendingError,
  ): Promise<void> {
    try {
      const content = await Deno.readTextFile(planPath);
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) throw new Error("Could not find frontmatter in plan");

      const frontmatter: RawFrontmatter = parseYaml(match[1]) as RawFrontmatter;
      const body = content.substring(match[0].length).trimStart();

      // Update status
      frontmatter.status = PlanStatus.AMENDMENT_PENDING;

      // Inject amendment metadata
      if (!frontmatter.amendment_id) {
        frontmatter.amendment_id = error.amendmentId;
        frontmatter.amendment_proposed_at = new Date().toISOString();
      }

      const updatedContent = `---\n${stringifyYaml(frontmatter)}---\n\n${body}`;
      await Deno.writeTextFile(planPath, updatedContent);
    } catch (e) {
      console.error("Failed to update plan status for amendment:", e);
    }

    this.logActivity(DomainEventType.ExecutionAmendmentPending, traceId, {
      request_id: requestId,
      amendment_id: error.amendmentId,
    });
  }

  /**
   * Scan for expired amendments and abort their plans
   */
  private async checkExpiredAmendments(): Promise<void> {
    try {
      const entries = await Array.fromAsync(Deno.readDir(this.plansDir));
      const planFiles = entries
        .filter((entry) => entry.isFile && entry.name.endsWith(".md"))
        .map((entry) => join(this.plansDir, entry.name));

      const expiryMs = this.config.amendment?.expiryMs ?? DEFAULT_AMENDMENT_EXPIRY_MS;
      const now = Date.now();

      for (const planPath of planFiles) {
        try {
          const frontmatter = await this.parsePlan(planPath);

          if (frontmatter.status === PlanStatus.AMENDMENT_PENDING) {
            const proposedAtStr = frontmatter.amendment_proposed_at;
            if (proposedAtStr) {
              const proposedAt = new Date(proposedAtStr).getTime();
              if (now - proposedAt > expiryMs) {
                const requestId = frontmatter.request_id ?? "unknown";
                const traceId = frontmatter.trace_id ?? "unknown";
                const amendmentId = frontmatter.amendment_id ?? null;
                const onTimeout = this.config.amendment?.on_timeout ?? DEFAULT_AMENDMENT_ON_TIMEOUT;

                switch (onTimeout) {
                  case "reject": {
                    this.logActivity(PLAN_AMENDMENT_EVENT_REJECTED, traceId, {
                      request_id: requestId,
                      amendment_id: amendmentId,
                      decidedBy: "timeout",
                      rationale: "Amendment rejected due to HITL timeout",
                      timestamp: new Date().toISOString(),
                    });
                    const content = await Deno.readTextFile(planPath);
                    const updated = content.replace(
                      /status: "?amendment_pending"?/,
                      `status: ${PlanStatus.REJECTED}`,
                    );
                    await Deno.writeTextFile(planPath, updated);
                    break;
                  }
                  case "approve": {
                    this.logActivity(PLAN_AMENDMENT_EVENT_APPROVED, traceId, {
                      request_id: requestId,
                      amendment_id: amendmentId,
                      decidedBy: "timeout",
                      rationale: "Amendment approved due to HITL timeout",
                      timestamp: new Date().toISOString(),
                    });
                    const content = await Deno.readTextFile(planPath);
                    const updated = content.replace(
                      /status: "?amendment_pending"?/,
                      `status: ${PlanStatus.APPROVED}`,
                    );
                    await Deno.writeTextFile(planPath, updated);
                    break;
                  }
                  default: {
                    this.logActivity(PLAN_AMENDMENT_EVENT_EXPIRED, traceId, {
                      request_id: requestId,
                      amendment_id: amendmentId,
                      decidedBy: "timeout",
                      rationale: "Amendment expired due to HITL timeout",
                      timestamp: new Date().toISOString(),
                    });
                    await this.handleFailure(
                      planPath,
                      traceId,
                      requestId,
                      "Plan amendment request expired (timeout).",
                      undefined,
                    );
                  }
                }
              }
            }
          }
        } catch {
          continue;
        }
      }
    } catch (error) {
      console.error("Failed to check for expired amendments:", error);
    }
  }

  /**
   * Create a MissionReporter instance with Memory Bank integration
   */
  private createMissionReporter(): MissionReporter {
    const memoryBank =
      (this.context?.memoryBank ?? new MemoryBankService(this.config, this.logger)) as MemoryBankService;
    const reportConfig = {
      reportsDirectory: join(
        this.config.system.root,
        this.config.paths.memory,
        DEFAULT_EXECUTION_MEMORY_PATH,
      ),
    };
    const reader = this.db
      ? {
        getActivitiesByTrace: (id: string) => this.db!.getActivitiesByTrace(id),
        getActivitiesByTraceSafe: (id: string) => this.db!.getActivitiesByTraceSafe(id),
        getRecentActivity: (limit?: number) => this.db!.getRecentActivity(limit),
        queryActivity: (filter) => this.db!.queryActivity(filter),
      } as IEventJournalReader
      : undefined;
    return new MissionReporter(this.config, reportConfig, memoryBank, this.logger, reader);
  }

  /**
   * Auto-extract learnings from execution using the configured MemoryExtractorService.
   * Loads the persisted execution record and delegates to analyzeExecution + createProposal.
   */
  private async extractExecutionLearnings(traceId: string): Promise<void> {
    if (!this.context?.extractor) return;

    try {
      const memoryBank =
        (this.context?.memoryBank ?? new MemoryBankService(this.config, this.logger)) as MemoryBankService;
      const executionMemory = await memoryBank.getExecutionByTraceId(traceId);
      if (!executionMemory) return;

      const learnings = this.context.extractor.analyzeExecution(executionMemory);
      for (const learning of learnings) {
        await this.context.extractor.createProposal(learning, executionMemory, this.identityId);
        if (this.sessionMemory) {
          await this.sessionMemory.saveInsight({
            title: learning.title,
            description: learning.description,
            category: learning.category,
            tags: learning.tags,
            confidence: mapToConfidenceLevel(learning.confidence),
          });
        }
      }
    } catch (error) {
      console.error("[ExecutionLoop] Failed to extract memory learnings:", error);
    }
  }

  /**
   * Commit changes to git, handling "nothing to commit" gracefully
   */
  private async commitChanges(
    gitService: IGitService,
    requestId: string,
    traceId: string,
  ): Promise<string | null> {
    try {
      return await gitService.commit({
        message: `Execute plan: ${requestId}`,
        description: `Executed by agent ${this.identityId}`,
        traceId,
      });
    } catch (error) {
      // If no changes to commit, that's actually a success (nothing needed to be done)
      if (error instanceof Error && error.message.includes("nothing to commit")) {
        // Log but don't fail
        this.logActivity(DomainEventType.ExecutionNoChanges, traceId, {
          request_id: requestId,
        });
        return null;
      } else {
        throw error;
      }
    }
  }

  /**
   * Register a new review after successful execution
   */
  private async registerReview(
    requestId: string,
    traceId: string,
    portal: string,
    branch: string,
    commitSha: string,
    repository: string,
    baseBranch: string,
    worktreePath?: Opt<string, Reason.OptionalInput>,
  ): Promise<void> {
    try {
      console.log(`[ExecutionLoop] Registering review for ${requestId} (Branch: ${branch})`);
      if (this.reviewRegistry) {
        await this.reviewRegistry.register({
          trace_id: traceId,
          portal: portal,
          branch: branch,
          repository,
          base_branch: baseBranch,
          worktree_path: worktreePath,
          description: `Execution for request ${requestId}`,
          commit_sha: commitSha,
          files_changed: 1, // Defaulting to 1 for now
          created_by: this.identityId,
        });
        console.log(`[ExecutionLoop] Review registered successfully`);
      } else {
        console.error("[ExecutionLoop] reviewRegistry is NOT initialized!");
      }
    } catch (error) {
      console.error("[ExecutionLoop] Failed to register review:", error);
    }
  }

  /**
   * Generate mission report for successful execution using Memory Banks
   */
  private async generateMissionReport(
    traceId: string,
    requestId: string,
    frontmatter?: Opt<PlanFrontmatter, Reason.OptionalInput>,
  ): Promise<void> {
    try {
      const reporter = this.createMissionReporter();

      const contextFiles: string[] = [];
      if (frontmatter?.portal) {
        contextFiles.push(frontmatter.portal);
      }

      // Prepare trace data
      const traceData = {
        traceId,
        requestId,
        identityId: this.identityId,
        status: ExecutionStatus.COMPLETED,
        branch: `feat/${requestId}-${traceId.substring(0, 8)}`,
        completedAt: new Date(),
        contextFiles,
        reasoning: "Plan execution completed successfully",
        summary: `Successfully executed plan for request: ${requestId}`,
      };

      await reporter.generate(traceData);

      this.logActivity(DomainEventType.ReportGenerated, traceId, {
        request_id: requestId,
        report_type: "mission",
        reporter: "memory_banks",
      });
    } catch (error) {
      this.logActivity(DomainEventType.ReportError, traceId, {
        request_id: requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Generate failure report using Memory Banks
   */
  private async generateFailureReport(
    traceId: string,
    requestId: string,
    error: string,
    frontmatter?: Opt<PlanFrontmatter, Reason.OptionalInput>,
  ): Promise<void> {
    try {
      const reporter = this.createMissionReporter();

      const contextFiles: string[] = [];
      if (frontmatter?.portal) {
        contextFiles.push(frontmatter.portal);
      }

      // Prepare trace data for failure
      const traceData = {
        traceId,
        requestId,
        identityId: this.identityId,
        status: ExecutionStatus.FAILED,
        branch: `feat/${requestId}-${traceId.substring(0, 8)}`,
        completedAt: new Date(),
        contextFiles,
        reasoning: `Plan execution failed: ${error}`,
        summary: `Execution failed for request: ${requestId}`,
      };

      await reporter.generate(traceData);

      // Also write a human-readable failure.md file for easy access (tests expect this file)
      try {
        const failureDir = join(
          this.config.system.root,
          this.config.paths.memory,
          DEFAULT_EXECUTION_MEMORY_PATH,
          traceId,
        );
        await Deno.mkdir(failureDir, { recursive: true });
        const failureContent =
          `# Failure Report\n\n**Trace ID:** ${traceId}\n**Request ID:** ${requestId}\n**Agent:** ${this.identityId}\n**Error:** ${error}\n\n**Summary:** ${traceData.summary}\n**Reasoning:** ${traceData.reasoning}\n\nGenerated at ${
            new Date().toISOString()
          }`;
        await Deno.writeTextFile(join(failureDir, "failure.md"), failureContent);
      } catch (_e) {
        // Non-fatal - logging already handled below
      }

      this.logActivity(DomainEventType.ReportGenerated, traceId, {
        request_id: requestId,
        report_type: "failure",
        reporter: "memory_banks",
        error,
      });
    } catch (reportError) {
      this.logActivity(DomainEventType.ReportError, traceId, {
        request_id: requestId,
        error: reportError instanceof Error ? reportError.message : String(reportError),
      });
    }
  }

  /**
   * Log activity to database
   */
  private logActivity(
    actionType: string,
    traceId: string,
    payload: Record<string, JSONValue>,
  ): void {
    if (!this.logger) return;
    void this.logger.info(actionType, null, payload, traceId);
  }

  /**
   * Update request status and archive the file to keep the Workspace/Requests inbox clean.
   */
  private async archiveRequest(
    requestId: string,
    status: ExecutionStatus | string,
    targetDir: string,
  ): Promise<void> {
    const requestsDir = join(
      this.config.system.root,
      this.config.paths.workspace,
      this.config.paths.requests,
    );
    const requestPath = join(requestsDir, `${requestId}.md`);

    if (!(await exists(requestPath))) return;

    try {
      // 1. Update status in file
      const content = await Deno.readTextFile(requestPath);
      const updatedContent = content.replace(
        /status: "?\w+"?/,
        `status: ${status}`,
      );
      await Deno.writeTextFile(requestPath, updatedContent);

      // 2. Archive file
      await Deno.mkdir(targetDir, { recursive: true });
      const targetPath = join(targetDir, `${requestId}.md`);

      // Use rename to move it
      await Deno.rename(requestPath, targetPath);
    } catch (error) {
      console.warn(`Failed to archive request ${requestId} to ${targetDir}:`, error);
    }
  }
}

function mapToConfidenceLevel(
  level: string,
): ConfidenceLevel {
  switch (level) {
    case ConfidenceAssessmentLevel.VERY_LOW:
    case ConfidenceAssessmentLevel.LOW:
      return ConfidenceLevel.LOW;
    case ConfidenceAssessmentLevel.MEDIUM:
      return ConfidenceLevel.MEDIUM;
    case ConfidenceAssessmentLevel.HIGH:
    case ConfidenceAssessmentLevel.VERY_HIGH:
      return ConfidenceLevel.HIGH;
    default:
      return ConfidenceLevel.LOW;
  }
}
