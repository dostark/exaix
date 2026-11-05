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

import { listPlanFiles } from "./execution_plan_reader.ts";
import * as pathBuilders from "@exaix/shared";
import { join } from "@std/path";

import type { Config } from "@exaix/schemas/config.ts";
import type { IApplicationContext, IPlanAmendmentGate, IPlanAmendmentService } from "@exaix/core/types";
import type { IDatabaseService } from "@exaix/core/types";

import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType, type TDomainEventType } from "@exaix/core/events";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { ModelResolver } from "@exaix/ai";
import type { IGitService, IGitServiceFactory, IMemoryBankService, IToolRegistryFactory } from "@exaix/core/types";

import type { PlanFrontmatter } from "@exaix/schemas/plan_schema.ts";
import { IBlueprintLoader } from "@exaix/core/blueprint";
import type { ReviewRegistry } from "@exaix/core/artifact";
import type { SessionMemoryService } from "@exaix/memory";

import type { IGuardrailRunner } from "./guardrail_runner.ts";

import { PlanStatus } from "@exaix/core/status";
import type { IHitlPolicyEvaluator, IModelRegistry, IToolConfirmationInterceptor } from "@exaix/core/types";
import type { HitlRule } from "@exaix/schemas/hitl.ts";

import { PlanAmendmentPendingError } from "@exaix/core/planning";
import type { IFixedModelClient } from "@exaix/schemas";

import type { IEffortResolver } from "@exaix/ai";
import { ConfidenceScorer } from "./confidence_scorer.ts";
import { captureImmutableCommit, ExecutionVerification } from "./execution_verification.ts";
import { ExecutionPlanRunner, missingFactory } from "./execution_plan_runner.ts";
import { ExecutionOutcomes } from "./execution_outcomes.ts";
import { ExecutionReporting } from "./execution_reporting.ts";
import { ExecutionAmendments } from "./execution_amendments.ts";
import { ExecutionPlanReader } from "./execution_plan_reader.ts";
import { GitExecutionSetupService } from "./git_execution_setup_service.ts";
import type { IVerificationRunner } from "./verification_runner.ts";

import { resolveLintSettings } from "@exaix/schemas/lint_settings.ts";

import type { JSONValue } from "@exaix/core";

export interface IExecutionLoopConfig {
  config: Config;
  db?: IDatabaseService;
  logger?: IEventLogger;
  agentRole: string;
  llmProvider?: IModelProvider;
  /** The EffortResolver for execution-path resolution. PlanExecutor and AgentComposer use their own default when absent. */
  effortResolver?: IEffortResolver;
  amendmentService?: IPlanAmendmentService;
  amendmentGate?: IPlanAmendmentGate;
  /** Threaded into PlanExecutor's IPlanExecutorOptions so
   *  AgentComposer.resolveModelFromBlueprint's ModelResolver.resolve() branch is
   *  reachable during real plan execution. */
  modelResolver?: ModelResolver;
  /** The provider type and model of llmProvider, threaded into IPlanExecutorOptions.fixedClient. */
  fixedClient?: IFixedModelClient;
  /** Threaded into PlanExecutor's IPlanExecutorOptions so AgentComposer's internally-constructed
   *  PromptBudgetAllocator resolves a step's real context window instead of always falling back to the
   *  hardcoded 128K default. */
  modelRegistry?: IModelRegistry;
  reviewRegistry?: ReviewRegistry;
  context?: IApplicationContext;
  sessionMemory?: SessionMemoryService;
  /** Optional guardrail runner for PlanExecutor. */
  guardrailRunner?: IGuardrailRunner;
  /** Per-action HITL policy evaluator for ToolRegistry pipeline. */
  hitlPolicyEvaluator?: IHitlPolicyEvaluator;
  /** Confirmation interceptor for HITL approval flow. */
  confirmationInterceptor?: IToolConfirmationInterceptor;
  /** Blueprint-level HITL rules passed to ToolRegistry. */
  hitlBlueprintRules?: HitlRule[];
  /** Optional callback invoked when a code-changes delegation result is reconciled. Wired at daemon construction
   *  from HeadlessSessionLauncher; PlanExecutor calls this to delegate code-change steps to a foreign agent
   *  without importing the concrete launcher (layer-boundary seam). */
  onCodeChangesDelegate?: (
    traceId: string,
    step: { number: number; title: string; content: string; successCriteria?: string[] },
    worktreePath: string,
    agentRole: string,
  ) => Promise<string>;

  /** Factory for creating per-execution IGitService instances. Required if portal/worktree execution is used. */
  gitServiceFactory?: IGitServiceFactory;
  /** Factory for creating per-execution IToolRegistry instances. Required if plan-action execution is used. */
  toolRegistryFactory?: IToolRegistryFactory;
  /** Pre-configured IMemoryBankService. Falls back to context.memoryBank. Required if mission reports are used. */
  memoryBank?: IMemoryBankService;
  /** Daemon secret values redacted from a verification check's failure output before the repair prompt. */
  knownSecrets?: readonly string[];
  /** Builds the per-execution verification runner. Defaults to the real VerificationRunner. */
  verificationRunnerFactory?: (logger: IEventLogger, knownSecrets: readonly string[]) => IVerificationRunner;
}

export interface IExecutionResult {
  success: boolean;
  traceId?: string;
  error?: string;
}

interface ITaskLease {
  filePath: string;
  holder: string;
  acquiredAt: Date;
}

/** Options for internal execution */
interface IExecuteOptions {
  /** Path to the plan file */
  planPath: string;
  /** Whether to require actions in the plan */
  requireActions: boolean;
  /** Whether to initialize Git with branch creation */
  initGitBranch: boolean;
}

/** @visible */
export class ExecutionLoop {
  private config: Config;
  private db?: IDatabaseService;
  private logger?: IEventLogger;
  private agentRole: string;
  private plansDir: string;
  private leases = new Map<string, ITaskLease>();
  private blueprintLoader: IBlueprintLoader;
  private context?: IApplicationContext;
  private reviewRegistry?: ReviewRegistry;
  private llmProvider?: IModelProvider;
  private modelResolver?: ModelResolver;
  private fixedClient?: IFixedModelClient;
  private modelRegistry?: IModelRegistry;
  private confidenceScorer?: ConfidenceScorer;
  private amendmentService?: IPlanAmendmentService;
  private amendmentGate?: IPlanAmendmentGate;
  private sessionMemory?: SessionMemoryService;
  private guardrailRunner?: IGuardrailRunner;
  private effortResolver?: IEffortResolver;
  private hitlPolicyEvaluator?: IHitlPolicyEvaluator;
  private confirmationInterceptor?: IToolConfirmationInterceptor;
  private hitlBlueprintRules?: HitlRule[];
  private onCodeChangesDelegate?: (
    traceId: string,
    step: { number: number; title: string; content: string; successCriteria?: string[] },
    worktreePath: string,
    agentRole: string,
  ) => Promise<string>;
  private gitServiceFactory?: IGitServiceFactory;
  private toolRegistryFactory?: IToolRegistryFactory;
  private memoryBank?: IMemoryBankService;
  private readonly verification: ExecutionVerification;
  private readonly planReader: ExecutionPlanReader;
  private readonly amendments: ExecutionAmendments;
  private readonly reporting: ExecutionReporting;
  private readonly outcomes: ExecutionOutcomes;
  private readonly planRunner: ExecutionPlanRunner;
  private gitExecutionSetupService: GitExecutionSetupService;

  constructor(
    config: IExecutionLoopConfig,
  ) {
    const ctx = config.context;
    this.config = ctx?.config.get() || config.config;
    this.db = ctx?.db || config.db;
    this.logger = config.logger;
    this.agentRole = config.agentRole;
    this.llmProvider = ctx?.provider || config.llmProvider;
    this.amendmentService = config.amendmentService;
    this.amendmentGate = config.amendmentGate;
    this.modelResolver = config.modelResolver;
    this.fixedClient = config.fixedClient;
    this.modelRegistry = config.modelRegistry;
    this.reviewRegistry = config.reviewRegistry;
    this.context = ctx;
    this.sessionMemory = config.sessionMemory;
    this.guardrailRunner = config.guardrailRunner;
    this.hitlPolicyEvaluator = config.hitlPolicyEvaluator;
    this.confirmationInterceptor = config.confirmationInterceptor;
    this.hitlBlueprintRules = config.hitlBlueprintRules;
    this.effortResolver = config.effortResolver;
    this.onCodeChangesDelegate = config.onCodeChangesDelegate;
    this.gitServiceFactory = config.gitServiceFactory;
    this.toolRegistryFactory = config.toolRegistryFactory;
    this.memoryBank = config.memoryBank ?? ctx?.memoryBank;
    this.planReader = new ExecutionPlanReader({
      logger: this.logger,
      journal: (action, traceId, payload) => this.logActivity(action, traceId, payload),
    });
    this.verification = new ExecutionVerification({
      config: this.config,
      logger: this.logger,
      lintSettings: resolveLintSettings(this.config, this.context?.configAdapter),
      knownSecrets: config.knownSecrets ?? [],
      runnerFactory: config.verificationRunnerFactory,
      defaultLintSettings: () => resolveLintSettings(this.config, this.context?.configAdapter),
      journal: (action, traceId, payload) => this.logActivity(action, traceId, payload),
      executeRepair: (plan, root, git, frontmatter, planPath, options) =>
        this.planRunner.executeStructuredPlan(plan, root, git, frontmatter, planPath, options),
    });
    this.gitExecutionSetupService = new GitExecutionSetupService(this.config, this.gitServiceFactory);
    this.plansDir = join(this.config.system.root, this.config.paths.workspace, this.config.paths.active);
    this.blueprintLoader = new IBlueprintLoader({
      blueprintsPath: join(this.config.system.root, this.config.paths.blueprints, this.config.paths.agents),
    });

    this.reporting = new ExecutionReporting({
      config: this.config,
      db: this.db,
      logger: this.logger,
      memoryBank: this.memoryBank,
      reviewRegistry: this.reviewRegistry,
      extractor: this.context?.extractor,
      agentRole: this.agentRole,
      journal: (action, traceId, payload) => this.logActivity(action, traceId, payload),
    });
    this.outcomes = new ExecutionOutcomes({
      config: this.config,
      db: this.db,
      reporting: this.reporting,
      journal: (action, traceId, payload) => this.logActivity(action, traceId, payload),
    });
    this.amendments = new ExecutionAmendments({
      config: this.config,
      plansDir: this.plansDir,
      amendmentGate: this.amendmentGate,
      planReader: this.planReader,
      journal: (action, traceId, payload) => this.logActivity(action, traceId, payload),
      failPlan: (planPath, traceId, requestId, message, cleanup) =>
        this.outcomes.handleFailure(planPath, traceId, requestId, message, cleanup),
    });

    if (this.llmProvider) {
      this.confidenceScorer = new ConfidenceScorer(this.llmProvider, {
        lowConfidenceThreshold: this.config.amendment?.threshold,
      });
    }

    this.planRunner = new ExecutionPlanRunner({
      config: this.config,
      db: this.db,
      logger: this.logger,
      llmProvider: this.llmProvider,
      context: this.context,
      confidenceScorer: this.confidenceScorer,
      amendmentService: this.amendmentService,
      amendmentGate: this.amendmentGate,
      onCodeChangesDelegate: this.onCodeChangesDelegate,
      modelResolver: this.modelResolver,
      modelRegistry: this.modelRegistry,
      fixedClient: this.fixedClient,
      effortResolver: this.effortResolver,
      guardrailRunner: this.guardrailRunner,
      toolRegistryFactory: this.toolRegistryFactory,
      planReader: this.planReader,
      blueprintLoader: this.blueprintLoader,
      gitExecutionSetupService: this.gitExecutionSetupService,
      journal: (action, traceId, payload) => this.logActivity(action, traceId, payload),
    });
  }

  private async createWorktreeExecutionPointer(
    traceId: string,
    canonicalWorktreePath: string,
    pointerName: string,
  ): Promise<void> {
    const traceDir = pathBuilders.memoryExecutionPath(join(this.config.system.root, this.config.paths.memory), traceId);
    await Deno.mkdir(traceDir, { recursive: true });

    const pointerPath = join(traceDir, pointerName);

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
      frontmatter = await this.planReader.parsePlan(planPath);
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

      const portalRepoRoot = this.gitExecutionSetupService.resolvePortalRepoRoot(frontmatter);
      portalGitService = this.gitServiceFactory?.createGitService(portalRepoRoot, traceId) ??
        missingFactory("gitServiceFactory", "git operations");

      const planContent = await this.planReader.readPlanContent(planPath);
      const prepared = await this.planRunner.preparePlanExecution(frontmatter, planContent);

      const gitSetup = await this.gitExecutionSetupService.setupGitForExecution({
        initGitBranch,
        hasExecutableWork: prepared.hasExecutableWork && !prepared.isReadOnly,
        frontmatter,
        requestId: requestId!,
        traceId: traceId!,
        portalRepoRoot,
        portalGitService: portalGitService!,
        executionStrategy: prepared.executionStrategy,
        createWorktreeExecutionPointer: this.createWorktreeExecutionPointer.bind(this),
      });
      worktreePath = gitSetup.worktreePath;
      const baseSha = await captureImmutableCommit(gitSetup.executionGitService);

      const workResult = await this.planRunner.executePlanWork({
        structuredPlan: prepared.structuredPlan,
        actions: prepared.actions,
        isReadOnly: prepared.isReadOnly,
        planAgentId: prepared.planAgentId,
        requireActions,
        traceId,
        requestId,
        planPath,
        frontmatter,
        executionRoot: gitSetup.executionRoot,
        executionGitService: gitSetup.executionGitService,
      });

      // Commit changes (if any)
      if (workResult.report) {
        await this.reporting.persistExecutionReport(traceId, workResult.report);
      }

      const commitShaOf = async (): Promise<string | null> => {
        if (workResult.commitSha) return workResult.commitSha;
        if (!workResult.didMutateRepo || !gitSetup.branchName) return null;
        return await this.gitExecutionSetupService.commitChanges(
          gitSetup.executionGitService,
          requestId!,
          traceId!,
          this.agentRole,
          (noChangesTraceId, noChangesRequestId) => {
            this.logActivity(DomainEventType.ExecutionNoChanges, noChangesTraceId, {
              request_id: noChangesRequestId,
            });
          },
        );
      };
      const commitSha = await commitShaOf();

      const originalStepTitles = prepared.structuredPlan?.steps.map((step) => step.title) ??
        prepared.actions.map((action) => action.description ?? action.tool);
      const verification = await this.verification.run(frontmatter, {
        isReadOnly: prepared.isReadOnly,
        commitSha: commitSha ?? null,
        executionRoot: gitSetup.executionRoot,
        requestId: requestId!,
        traceId: traceId!,
        planPath,
        executionGitService: gitSetup.executionGitService,
        originalStepTitles,
        baseSha,
      });

      // Register review
      const planFrontmatter = frontmatter;
      const registerReviewForVerification = async (): Promise<void> => {
        if (!verification.commitSha) return;
        const baseBranch = gitSetup.baseBranch ??
          await this.gitExecutionSetupService.resolveBaseBranch(planFrontmatter, portalGitService!, portalRepoRoot);
        const branch = await gitSetup.executionGitService.getCurrentBranch();
        await this.reporting.registerReview({
          requestId: requestId!,
          traceId: traceId!,
          portal: planFrontmatter.portal || "unknown",
          branch,
          commitSha: verification.commitSha,
          repository: portalRepoRoot,
          baseBranch,
          worktreePath: gitSetup.worktreePath,
        });
      };
      await registerReviewForVerification();

      // Handle success
      await this.outcomes.handleSuccess(
        planPath,
        traceId!,
        requestId!,
        frontmatter,
        {
          isReadOnly: prepared.isReadOnly,
          planAgentId: prepared.planAgentId,
          portal: frontmatter.portal,
          targetBranch: frontmatter.target_branch,
          verificationStatus: verification.status,
          verificationCommitSha: verification.commitSha,
          ...(verification.runId === undefined ? {} : { verificationRunId: verification.runId }),
        },
        workResult.completionSummary,
      );

      return { success: true, traceId };
    } catch (error) {
      if (error instanceof PlanAmendmentPendingError) {
        await this.amendments.handleAmendmentPending(planPath, traceId!, requestId!, error, {
          portalGitService,
          worktreePath,
        });
        return { success: true, traceId };
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      if (traceId && requestId && leaseAcquired) {
        await this.outcomes.handleFailure(planPath, traceId, requestId, errorMessage, frontmatter, {
          portalGitService,
          worktreePath,
        });
      }
      return { success: false, traceId, error: errorMessage };
    } finally {
      this.releaseLease(planPath);
    }
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
    await this.amendments.checkExpiredAmendments();

    try {
      const planFiles = await listPlanFiles(this.plansDir);

      for (const planPath of planFiles) {
        // Skip if already leased
        if (this.leases.has(planPath)) {
          continue;
        }

        // Read frontmatter to check status
        try {
          const frontmatter = await this.planReader.parsePlan(planPath);
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
   * Acquire lease on task file
   */
  private ensureLease(filePath: string, traceId: string): void {
    // Check if already leased
    const existingLease = this.leases.get(filePath);
    if (existingLease && existingLease.holder !== this.agentRole) {
      throw new Error(
        `Task lease already held by ${existingLease.holder}`,
      );
    }

    // Acquire lease
    this.leases.set(filePath, {
      filePath,
      holder: this.agentRole,
      acquiredAt: new Date(),
    });

    this.logActivity(DomainEventType.ExecutionLeaseAcquired, traceId, {
      file_path: filePath,
      holder: this.agentRole,
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

  /** Proposes memory learnings from the execution of the trace, when an extractor is configured. */
  async extractExecutionLearnings(traceId: string): Promise<void> {
    await this.reporting.extractExecutionLearnings(traceId);
  }

  /** Log activity to database */
  private logActivity(
    actionType: TDomainEventType,
    traceId: string,
    payload: Record<string, JSONValue>,
  ): void {
    if (!this.logger) return;
    void this.logger.info(actionType, null, payload, traceId);
  }
}
