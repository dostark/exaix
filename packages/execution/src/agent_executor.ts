/**
 * @module AgentExecutor
 * @path packages/execution/src/agent_executor.ts
 * @description Thin orchestrator that delegates to injected services for
 *   blueprint loading (BlueprintService), prompt building (PromptBuilder),
 *   git audit (GitAuditService), output parsing (OutputParser), history
 *   management (HistoryManager), budget/context (ExecutionContextService),
 *   and strategy dispatch (StrategyRegistry). ~950 lines after extracting
 *   6 sub-domain services from the original ~1750.
 * @architectural-layer Execution
 * @related-files [
 *   "packages/execution/src/blueprint_service.ts",
 *   "packages/execution/src/execution_context_service.ts",
 *   "packages/execution/src/git_audit_service.ts",
 *   "packages/execution/src/output_parser.ts",
 *   "packages/execution/src/history_manager.ts",
 *   "packages/execution/src/react_loop_adapter.ts",
 *   "packages/execution/src/agent_runner.ts"
 * ]
 */

import { join } from "@std/path";
import type { Config, IPortalConfig } from "@exaix/schemas/config.ts";
import type { HitlPolicy } from "@exaix/schemas/hitl.ts";
import type { IDatabaseService } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import { ActorType, AGENT_GENERATION_COMPLETED, AgentKind, LogLevel } from "@exaix/core";
import type { IWorkspaceExecutionContext, PathResolver, PortalPermissionsService } from "@exaix/portal";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { ModelResolver } from "@exaix/ai";
import type { IModelCallOptions, IModelIntent } from "@exaix/schemas";
import {
  AGENT_EVENT_EXECUTION_COMPLETED,
  AGENT_EVENT_EXECUTION_FAILED,
  AGENT_EVENT_EXECUTION_STARTED,
  AGENT_EVENT_SECURITY_VIOLATION,
  AGENT_EXECUTOR_ID,
} from "@exaix/core";
import { DEFAULT_MCP_IDENTITY_ID } from "@exaix/mcp";
import type {
  IAgentExecutionOptions,
  IAgentExecutionOptionsInput,
  IChangesetResult,
  IExecutionContext,
} from "@exaix/schemas/agent_executor.ts";
import type { IToolRegistry } from "@exaix/core/types";
import { AgentExecutionErrorType, ExecutionStrategyName, SecurityMode } from "@exaix/core";
import { InputValidator } from "@exaix/schemas/input_validation.ts";
import { isReadOnlyAgentCapabilities, requiresGitTracking } from "@exaix/core/func";
import type { JSONValue } from "@exaix/core";
import { StrategyRegistry } from "./strategies/strategy_registry.ts";
import { LegacyAgentStrategy } from "./strategies/legacy_strategy.ts";
import { McpAgentStrategy } from "./strategies/mcp_agent_strategy.ts";
import { ReActLoopStrategy } from "./strategies/react_loop_strategy.ts";
import type { IGuardrailRunner } from "./guardrail_runner.ts";
import type { Opt, Reason, TaskType } from "@exaix/core/types";
import { DEFAULT_KEEP_LAST_N_STEPS, SafeSubprocess, TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core";
import {
  DEFAULT_GIT_CHECKOUT_TIMEOUT_MS,
  DEFAULT_GIT_CLEAN_TIMEOUT_MS,
  DEFAULT_GIT_DIFF_TIMEOUT_MS,
  DEFAULT_GIT_LOG_TIMEOUT_MS,
  DEFAULT_GIT_LS_FILES_TIMEOUT_MS,
  DEFAULT_GIT_STATUS_TIMEOUT_MS,
} from "@exaix/git";
import { ToolRegistry } from "@exaix/tool-runtime";
import { AGENT_EVENT_OUTPUT } from "@exaix/core";
import type { ICompactedEntry, ILoopHistoryEntry } from "./types.ts";
import type { IPromptBudget } from "@exaix/schemas/prompt_budget.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { IContextBudgetManager } from "./context/context_budget_manager.ts";
import type { ISnapshotStore } from "./context/snapshot_store.ts";
import { ExecutionContextService } from "./execution_context_service.ts";
import { BlueprintService } from "./blueprint_service.ts";
import { PromptBuilder } from "./prompt_builder.ts";
import { GitAuditService } from "./git_audit_service.ts";
import { HistoryManager } from "./history_manager.ts";
import { type IOutputParserContext, OutputParser } from "./output_parser.ts";
import { ReActLoopAdapter } from "./react_loop_adapter.ts";

/**
 * Agent blueprint loaded from file
 */
export interface IAgentFileBlueprint {
  name: string;
  model: string;
  provider: string;
  capabilities: string[];
  permitted_tools?: string[];
  allowed_paths?: string[];
  systemPrompt: string;
  /** Per-action HITL governance rules (Phase 118). Resolved by ExecutionLoop for ToolRegistry path. */
  hitl?: HitlPolicy;
}

/** Optional configuration for AgentExecutor. */
export interface IAgentExecutorOptions {
  guardrailRunner?: IGuardrailRunner;
  /** Request-level IModelIntent fields override blueprint values (Phase 132). */
  requestIntent?: Partial<IModelIntent>;
  /**
   * Phase 135 Step 8 (§5.8.8) — the caller's highest-confidence skill match's
   * triggers.task_types, in priority order (first = most confident). AgentExecutor has
   * no SkillsService dependency; a caller that already matched skills (e.g. AgentRunner)
   * may supply this to participate in the derivation precedence chain.
   */
  topSkillTaskTypes?: TaskType[];
}

/** Dependencies for AgentExecutor constructor. */
export interface IAgentExecutorDeps {
  config: Config;
  db: IDatabaseService;
  logger: IEventLogger;
  pathResolver: PathResolver;
  permissions: PortalPermissionsService;
  provider?: IModelProvider;
  strategyRegistry?: StrategyRegistry;
  toolRegistry?: IToolRegistry;
  executionContext?: ExecutionContextService;
  blueprintService?: BlueprintService;
  promptBuilder?: PromptBuilder;
  gitAuditService?: GitAuditService;
  outputParser?: OutputParser;
  historyManager?: HistoryManager;
  guardrailRunner?: IGuardrailRunner;
  options?: IAgentExecutorOptions;
  modelResolver?: ModelResolver;
}

/**
 * Agent execution error class
 */
export class AgentExecutionError extends Error {
  constructor(
    message: string,
    public type: string = AgentExecutionErrorType.EXECUTION_ERROR,
    public override cause?: Opt<Error, Reason.OptionalDependency>,
  ) {
    super(message);
    this.name = "AgentExecutionError";
  }
}

/**
 * AgentExecutor — orchestrator and strategy dispatcher for agent execution.
 *
 * Delegates each concern to an injected service:
 *
 *   BlueprintService        → load, validate, and resolve agent blueprints
 *   PromptBuilder           → build and sanitize execution prompts
 *   ExecutionContextService → budget allocation, context cache, token counting
 *   GitAuditService         → git audit, SHA resolution, file path validation
 *   OutputParser            → LLM response parsing, changeset result validation
 *   HistoryManager          → loop history ring buffer, compaction, budget checking
 *   ReActLoopAdapter        → IReActLoopExecutor (decouples ReActLoopStrategy)
 *   StrategyRegistry        → selects IExecutionStrategy (ReAct, MCP, Legacy)
 *
 * Remaining concerns handled inline (not yet extracted):
 *   executeStep             → main execution method with blueprint loading,
 *                             budget allocation, strategy dispatch,
 *                             error handling, and result processing
 *   Public API              → logExecutionStart, logExecutionComplete,
 *                             getRecentActivitiesByTraceId, etc.
 *   Security                → buildSubprocessPermissions, auditAndRevertChanges
 *   Git operations          → auditAndRevertChanges (composite of audit + revert)
 *
 * @see BlueprintService
 * @see PromptBuilder
 * @see ExecutionContextService
 * @see GitAuditService
 * @see OutputParser
 * @see HistoryManager
 * @see ReActLoopAdapter
 */
export class AgentExecutor {
  private executionContext?: IWorkspaceExecutionContext;
  private originalWorkingDirectory?: string;
  private config: Config;
  private db: IDatabaseService;
  private logger: IEventLogger;
  private pathResolver: PathResolver;
  private permissions: PortalPermissionsService;
  private provider?: IModelProvider;
  private strategyRegistry?: StrategyRegistry;
  private _toolRegistry?: IToolRegistry;
  private _guardrailRunner?: IGuardrailRunner;
  private readonly options?: IAgentExecutorOptions;
  private modelResolver?: ModelResolver;
  private blueprintService: BlueprintService;
  private promptBuilder: PromptBuilder;
  private gitAuditService: GitAuditService;
  private outputParser: OutputParser;
  private historyManager: HistoryManager;
  private reActAdapter: ReActLoopAdapter;
  private ctx: ExecutionContextService;

  /** Resolved per-call options from ModelResolver, forwarded to generate(). */
  private _resolvedCallOptions?: IModelCallOptions;

  /** Exposes current prompt budget to IReActLoopExecutor (Phase 83). */
  public get currentPromptBudget(): IPromptBudget | undefined {
    return this.ctx.currentPromptBudget;
  }

  /** Exposes context budget manager to IReActLoopExecutor (Phase 83). */
  public get contextBudgetManager(): IContextBudgetManager | undefined {
    return this.ctx.contextBudgetManager;
  }

  /** Exposes snapshot store to async compaction tier (Phase 83). */
  public get snapshotStore(): ISnapshotStore | undefined {
    return this.ctx.snapshotStore;
  }

  /** Budget pressure logger forwarded to IReActLoopExecutor (Phase 83). */
  public get budgetLogger(): IEventLogger {
    return this.logger;
  }

  /**
   * Optional guardrail screening runner forwarded to IReActLoopExecutor (Phase 115 Step 1).
   * Undefined in Solo (the ReAct seam is a no-op); paid editions (P107) inject one via the
   * edition composer. Exposing it here is the production wiring path for the seam.
   */
  public get guardrailRunner(): IGuardrailRunner | undefined {
    return this._guardrailRunner;
  }

  constructor(deps: IAgentExecutorDeps) {
    this.config = deps.config;
    this.db = deps.db;
    this.logger = deps.logger;
    this.pathResolver = deps.pathResolver;
    this.permissions = deps.permissions;
    this.provider = deps.provider;
    this.strategyRegistry = deps.strategyRegistry;
    this._toolRegistry = deps.toolRegistry;
    this._guardrailRunner = deps.guardrailRunner;
    this.options = deps.options;
    this.modelResolver = deps.modelResolver;
    this.blueprintService = deps.blueprintService ??
      new BlueprintService(this.config, this.logger, deps.modelResolver, deps.options);
    this.ctx = deps.executionContext ?? new ExecutionContextService(this.config, this.logger, {
      promptBudgetAllocator: undefined,
      contextCache: undefined,
      tokenizer: undefined,
      contextBudgetManager: undefined,
      snapshotStore: undefined,
    });
    this.promptBuilder = deps.promptBuilder ?? new PromptBuilder(this.logger, this.ctx);
    this.gitAuditService = deps.gitAuditService ?? new GitAuditService(this.logger);
    this.outputParser = deps.outputParser ?? new OutputParser();
    this.historyManager = deps.historyManager ??
      new HistoryManager(this.config, this.logger, this.provider, this.db, this._resolvedCallOptions);
    this.reActAdapter = new ReActLoopAdapter(
      this.outputParser,
      this.ctx,
      this.logger,
      this._toolRegistry,
      undefined,
      deps.guardrailRunner,
    );
    if (deps.options?.guardrailRunner) {
      this._guardrailRunner = deps.options.guardrailRunner;
    }
    // If no registry provided, create one and register core strategies
    if (!this.strategyRegistry) {
      this.strategyRegistry = new StrategyRegistry();
      this.strategyRegistry.register(new LegacyAgentStrategy(this, this.provider));
      this.strategyRegistry.register(new ReActLoopStrategy(this.reActAdapter, this.provider));
      this.strategyRegistry.register(new McpAgentStrategy(this));
    }
  }

  /**
   * Lazily initialize or return the tool registry
   */
  public get toolRegistry(): IToolRegistry | undefined {
    if (!this._toolRegistry && this.config?.system?.root) {
      this._toolRegistry = new ToolRegistry({ config: this.config });
    }
    return this._toolRegistry;
  }

  public set toolRegistry(registry: IToolRegistry | undefined) {
    this._toolRegistry = registry;
  }

  /**
   * Loop history tracking completed execution steps for summarization.
   */

  /**
   * Compact older loop history entries to free budget.
   * Preserves the last `keepLastN` entries as individual steps and replaces
   * all older entries with a single compacted summary.
   */

  /**
   * Check if loop history exceeds the budget threshold and trigger compaction.
   */

  /**
   * Query recent activities for a given trace ID.
   * Used by sub-agents via parent_context_query to understand execution context.
   */
  public get loopHistory(): Array<ILoopHistoryEntry | ICompactedEntry> {
    return this.historyManager.loopHistory;
  }

  compactLoopHistory(
    keepLastN: Opt<number, Reason.SensibleDefault> = DEFAULT_KEEP_LAST_N_STEPS,
  ): Promise<void> {
    return this.historyManager.compactLoopHistory(keepLastN);
  }

  private async _checkLoopHistoryBudget(): Promise<void> {
    if (!this.ctx.currentPromptBudget) return;
    await this.historyManager.checkBudget(this.ctx.currentPromptBudget);
  }
  public async getRecentActivitiesByTraceId(
    traceId: string,
    limit: Opt<number, Reason.SensibleDefault> = 10,
  ): Promise<
    Array<{ actionType: string; target: string | null; payload: Record<string, JSONValue>; timestamp: string }>
  > {
    const records = await this.db.getActivitiesByTraceSafe(traceId);
    return records.slice(-limit).map((r) => {
      let payload: Record<string, JSONValue> = {};
      try {
        payload = JSON.parse(r.payload);
      } catch { /* ignore malformed payload */ }
      return {
        actionType: r.action_type,
        target: r.target,
        payload,
        timestamp: r.timestamp,
      };
    });
  }

  /**
   * Set execution context for agent operations
   * Changes working directory to context location
   */
  setExecutionContext(context: IWorkspaceExecutionContext): void {
    // Store original directory if not already stored
    if (!this.originalWorkingDirectory) {
      this.originalWorkingDirectory = Deno.cwd();
    }

    this.executionContext = context;
    this.promptBuilder.setPortalRoot(context.portalTarget);

    // Change to context working directory
    Deno.chdir(context.workingDirectory);
  }

  /**
   * Get current execution context
   */
  getExecutionContext(): IWorkspaceExecutionContext | undefined {
    return this.executionContext;
  }

  /**
   * Clear execution context and restore original directory
   */
  clearExecutionContext(): void {
    this.executionContext = undefined;

    // Restore original working directory
    if (this.originalWorkingDirectory) {
      try {
        Deno.chdir(this.originalWorkingDirectory);
      } catch (_error) {
        // Ignore if original directory no longer exists
      }
      this.originalWorkingDirectory = undefined;
    }
  }

  /**
   * Execute function within execution context, then restore
   * Ensures directory is always restored even if function throws
   */
  async withExecutionContext<T>(
    context: IWorkspaceExecutionContext,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const originalDir = Deno.cwd();

    try {
      this.setExecutionContext(context);
      return await fn();
    } finally {
      // Always restore directory
      try {
        Deno.chdir(originalDir);
      } catch (_error) {
        // Ignore
      }
      this.executionContext = undefined;
      this.originalWorkingDirectory = undefined;
    }
  }

  /**
   * Dispose of all resources (strategy signal listeners, etc.)
   * Call this when the AgentExecutor is no longer needed
   */
  dispose(): void {
    // Invalidate context cache at end of execution
    this.ctx.invalidateCache();

    // Dispose all strategies (which cleans up their signal listeners).
    // Uses the IExecutionStrategy.dispose?() optional-chaining contract.
    if (this.strategyRegistry) {
      for (const strategy of this.strategyRegistry.all()) {
        strategy.dispose?.();
      }
    }
  }

  /**
   * Get git repository path from current execution context
   */
  getGitRepository(): string | undefined {
    return this.executionContext?.gitRepository;
  }

  /**
   * Get allowed paths from current execution context
   */
  getAllowedPaths(): string[] | undefined {
    return this.executionContext?.allowedPaths;
  }

  /**
   * Determine if agent requires git tracking based on capabilities
   * Agents with write capabilities need branch creation and commit tracking
   *
   * @param blueprint - Agent blueprint with capabilities
   * @returns true if agent has write capabilities requiring git tracking
   */
  requiresGitTracking(blueprint: IAgentFileBlueprint): boolean {
    return requiresGitTracking(blueprint.capabilities);
  }

  /**
   * Check if agent is read-only (no write capabilities)
   * Inverse of requiresGitTracking
   *
   * @param blueprint - Agent blueprint with capabilities
   * @returns true if agent has no write capabilities
   */
  isReadOnlyAgent(blueprint: IAgentFileBlueprint): boolean {
    return isReadOnlyAgentCapabilities(blueprint.capabilities);
  }

  /**
   * Load agent blueprint from file with security validation.
   */
  async loadBlueprint(rawAgentName: string): Promise<IAgentFileBlueprint> {
    const result = await this.blueprintService.loadBlueprint(rawAgentName);
    this._resolvedCallOptions = result.resolvedCallOptions;
    return result.blueprint;
  }

  /**
   * Sanitize system prompt to prevent XSS and injection attacks
   */
  public static sanitizePrompt(prompt: string): string {
    return BlueprintService.sanitizePrompt(prompt);
  }
  /**
   * Execute a plan step using agent via MCP
   */
  async executeStep(
    rawContext: IExecutionContext,
    rawOptions: IAgentExecutionOptionsInput,
  ): Promise<IChangesetResult> {
    // ✓ Validate inputs first to prevent injection attacks
    const context = InputValidator.validateExecutionContext(rawContext);
    const options: IAgentExecutionOptions = InputValidator.validateAgentExecutionOptions(rawOptions);

    const _startTime = Date.now();

    // Validate portal exists
    const portal = this.config.portals?.find((p) => p.alias === options.portal);
    if (!portal) {
      throw new Error(`Portal not found: ${options.portal}`);
    }

    // Validate agent has permissions (check before loading blueprint)
    if (!this.permissions.checkAgentAllowed(options.portal, options.identity_id ?? "").allowed) {
      throw new Error(
        `Identity not allowed to access portal: ${options.identity_id} -> ${options.portal}`,
      );
    }

    // Load blueprint — capabilities array drives strategy dispatch (Phase 61: MCP > ReAct > Legacy fallback).
    const _blueprint = await this.loadBlueprint(options.identity_id ?? "");
    const modelId = this.resolveModelId(_blueprint);
    await this.ctx.allocateBudget(
      modelId,
      options.request_analysis as IRequestAnalysis | undefined,
    );

    // Log execution start
    await this.logExecutionStart(
      context.trace_id,
      options.identity_id ?? "",
      options.portal,
    );

    // Resolve strategy (Phase 61: prefer MCP or ReAct if specified, fallback to legacy)
    let strategyName = ExecutionStrategyName.LEGACY;
    if (_blueprint.capabilities.includes(ExecutionStrategyName.MCP)) {
      strategyName = ExecutionStrategyName.MCP;
    } else if (_blueprint.capabilities.includes(ExecutionStrategyName.REACT)) {
      strategyName = ExecutionStrategyName.REACT;
    }

    // Pass identity-level permitted_tools and allowed_paths to options (Phase 56/61 bridge)
    if (_blueprint.permitted_tools) {
      options.permitted_tools = _blueprint.permitted_tools;
    }
    if (_blueprint.allowed_paths) {
      options.allowed_paths = _blueprint.allowed_paths;
    }

    try {
      const strategy = this.strategyRegistry!.resolve(strategyName);
      // Forward resolved per-call options (thinking/effort) to the strategy
      if (this._resolvedCallOptions && "callOptions" in strategy) {
        (strategy as { callOptions?: IModelCallOptions }).callOptions = this._resolvedCallOptions;
      }
      const validated = await strategy.execute(_blueprint, context, options);

      // Real usage from the strategy, when reported; otherwise undefined —
      // logExecutionComplete's own default (token count + $0 cost, GAP-25) applies.
      // No heuristic cost estimation: GAP-23/GAP-24 established it cannot be made
      // accurate (output tokens are unknowable pre-call; input-side cache-tier
      // pricing is unpopulated data).
      const usage = validated.usage
        ? {
          tokens: validated.usage.prompt_tokens + validated.usage.completion_tokens,
          cost_usd_estimate: validated.usage.cost_usd,
          prompt_tokens: validated.usage.prompt_tokens,
          completion_tokens: validated.usage.completion_tokens,
        }
        : undefined;

      // Step 61.3/61.4: Real SHA and Audit
      const portalPath = portal.target_path;

      // 1. Capture real SHA
      validated.commit_sha = await this.getPortalHeadSha(portalPath);

      // 2. Perform Audit
      const unauthorizedChanges = await this.auditGitChanges(
        portalPath,
        options.allowed_paths ?? [],
      );

      if (unauthorizedChanges.length > 0) {
        // Revert if breach detected
        await this.revertUnauthorizedChanges(portalPath, unauthorizedChanges);

        // Log security violation
        await this.logger.error(AGENT_EVENT_SECURITY_VIOLATION, context.trace_id, {
          portal: options.portal,
          unauthorized_files: unauthorizedChanges,
          identity: options.identity_id,
        });

        throw new AgentExecutionError(
          `Security violation: Unauthorized file modifications detected in portal '${options.portal}'`,
          AgentExecutionErrorType.SECURITY_VIOLATION,
        );
      }

      // Track step in loop history for potential summarization. Falls back to a
      // char-count heuristic over the full step context (system prompt + request +
      // plan + description) when no strategy-reported usage exists — the same
      // sources the removed estimateExecutionUsage() counted (GAP-25). Loop-history
      // token tracking is unrelated to cost estimation and must not go unset or
      // shrink to a narrower text source than before.
      const loopHistoryTokens = usage?.tokens ?? Math.max(
        1,
        Math.ceil(
          (_blueprint.systemPrompt.length + context.request.length + context.plan.length +
            validated.description.length) / TOKEN_ESTIMATION_CHARS_PER_TOKEN,
        ),
      );
      this.historyManager.addEntry({
        type: "step",
        stepId: `${context.trace_id}-step-${this.historyManager.loopHistory.length + 1}`,
        description: validated.description || "executed step",
        filesChanged: validated.files_changed ?? [],
        tokens: loopHistoryTokens,
        timestamp: Date.now(),
      });

      // Budget-pressure check: compact if loop history exceeds 80% of its budget
      await this._checkLoopHistoryBudget();

      // Log completion
      await this.logExecutionComplete(
        context.trace_id,
        options.identity_id || "unknown",
        validated,
        usage,
      );

      return validated;
    } catch (error) {
      // Log error
      await this.logExecutionError(context.trace_id, options.identity_id ?? "", {
        type: AgentExecutionErrorType.EXECUTION_ERROR,
        message: error instanceof Error ? error.message : String(error),
        trace_id: context.trace_id,
      });

      throw error;
    } finally {
      this.ctx.clearBudget();
    }
  }

  /**
   * Log output from an agent subprocess
   */
  public async logAgentOutput(traceId: string, output: string): Promise<void> {
    await this.logger.info(AGENT_EVENT_OUTPUT, "subprocess", { output }, traceId);
  }

  /**
   * Build execution prompt for LLM agent
   */
  private resolveModelId(blueprint: IAgentFileBlueprint): string {
    return this.blueprintService.resolveModelId(blueprint);
  }

  /**
   * Build execution prompt for LLM agent.
   * Delegates to PromptBuilder.
   */
  buildExecutionPrompt(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
  ): Promise<string> {
    const modelId = this.resolveModelId(blueprint);
    return this.promptBuilder.buildExecutionPrompt(blueprint, context, options, modelId);
  }

  /**
   * Sanitize user input to prevent prompt injection attacks.
   */
  public sanitizeUserInput(input: string): string {
    return this.promptBuilder.sanitizeUserInput(input);
  }

  /**
   * Parse agent response to extract changeset result
   */

  /**
   * Build subprocess permissions based on security mode
   */
  buildSubprocessPermissions(
    mode: SecurityMode,
    portalPath: string,
  ): string[] {
    const flags: string[] = [];

    if (mode === SecurityMode.SANDBOXED) {
      // No file system access
      flags.push("--allow-read=NONE");
      flags.push("--allow-write=NONE");
    } else if (mode === SecurityMode.HYBRID) {
      // Read-only access to portal
      flags.push(`--allow-read=${portalPath}`);
      flags.push("--allow-write=NONE");
    }

    // Always allow network (for MCP connection)
    flags.push("--allow-net");

    // Always allow environment variables
    flags.push("--allow-env");

    return flags;
  }

  /**
   * Audit git changes to detect unauthorized modifications
   */

  /**
   * Get the current git SHA for a portal
   */

  /**
   * Validate file path for security - prevents path traversal and injection attacks
   * Returns the validated path or null if invalid
   */

  private isPathWithinPortal(portalPath: string, normalizedPath: string): boolean {
    const resolvedPortalPath = Deno.realPathSync(portalPath);
    const fullPath = join(portalPath, normalizedPath);

    try {
      const resolvedFullPath = Deno.realPathSync(fullPath);
      return resolvedFullPath === resolvedPortalPath || resolvedFullPath.startsWith(resolvedPortalPath + "/");
    } catch (_error) {
      // If the file doesn't exist, we still validate the path structure.
      for (const part of normalizedPath.split("/")) {
        if (part === ".." || part.startsWith(".")) return false;
      }

      const absoluteFullPath = join(resolvedPortalPath, normalizedPath);
      return absoluteFullPath === resolvedPortalPath || absoluteFullPath.startsWith(resolvedPortalPath + "/");
    }
  }

  /**
   * Revert unauthorized changes in hybrid mode
   * Uses git checkout to discard unauthorized modifications
   */

  /**
   * Atomic audit and revert operation to prevent TOCTOU race conditions
   * Performs git status check and file reversion in a single locked operation
   */
  auditGitChanges(portalPath: string, authorizedFiles: string[]): Promise<string[]> {
    return this.gitAuditService.auditGitChanges(portalPath, authorizedFiles);
  }

  getPortalHeadSha(portalPath: string): Promise<string> {
    return this.gitAuditService.getPortalHeadSha(portalPath);
  }

  public validateFilePath(filePath: string, portalPath: string): string | null {
    return this.gitAuditService.validateFilePath(filePath, portalPath);
  }

  revertUnauthorizedChanges(portalPath: string, unauthorizedFiles: string[]): Promise<void> {
    return this.gitAuditService.revertUnauthorizedChanges(portalPath, unauthorizedFiles);
  }
  async auditAndRevertChanges(
    portalPath: string,
    authorizedFiles: string[],
  ): Promise<{ reverted: string[]; failed: string[] }> {
    // 1. Acquire lock to prevent concurrent access
    const lockFile = join(portalPath, ".exa-git-lock");
    const lock = await this.acquireLock(lockFile);

    try {
      // 2. Get modified, untracked, and deleted files within the portal
      const result = await SafeSubprocess.run("git", [
        "ls-files",
        "--modified",
        "--others",
        "--deleted",
        "--exclude-standard",
        ".",
      ], {
        cwd: portalPath,
        timeoutMs: DEFAULT_GIT_STATUS_TIMEOUT_MS,
      });

      if (result.code !== 0) {
        throw new Error(`Git audit failed: ${result.stderr}`);
      }

      const fileList = result.stdout;
      if (!fileList) {
        return { reverted: [], failed: [] }; // No changes
      }

      // 3. Process changes immediately (no gap for TOCTOU)
      const results = { reverted: [] as string[], failed: [] as string[] };
      const _authorizedSet = new Set(authorizedFiles);

      for (const line of fileList.split("\n")) {
        const filename = line.trim();
        if (!filename) continue;

        // Skip the lock file we created
        if (filename === ".exa-git-lock") continue;

        // Consider any change as potentially unauthorized (modified, added, deleted, untracked)
        // Untracked files (??) are unauthorized new files
        const validated = this.validateFilePath(filename, portalPath);
        if (!validated) {
          // If the file is outside the portal (e.g. parent repo changes), ignore it rather than failing.
          // The agent's tools (write_file etc) already prevent modification outside the portal.
          continue;
        }

        // Check if file is officially authorized (part of the result object)
        if (_authorizedSet.has(filename)) {
          continue;
        }

        // If we get here, it's an unauthorized change.
        results.failed.push(filename);

        // Check if file is a symlink (detect potential attacks)
        try {
          const stat = await Deno.lstat(join(portalPath, filename));
          if (stat.isSymlink) {
            await this.logger.error(DomainEventType.SecuritySymlinkDetected, portalPath, { filename });
            // Already added to results.failed
            continue;
          }
        } catch {
          // File might not exist, that's ok for untracked files
        }

        // Revert immediately (in same atomic section)
        try {
          // Check if tracked
          const lsResult = await SafeSubprocess.run("git", ["ls-files", "--error-unmatch", validated], {
            cwd: portalPath,
            timeoutMs: DEFAULT_GIT_LS_FILES_TIMEOUT_MS,
          });

          if (lsResult.code === 0) {
            // Tracked file - restore
            await SafeSubprocess.run("git", ["restore", "--source=HEAD", "--", validated], {
              cwd: portalPath,
              timeoutMs: DEFAULT_GIT_CHECKOUT_TIMEOUT_MS,
            });
            results.reverted.push(filename);
          } else {
            // Untracked file - clean
            await SafeSubprocess.run("git", ["clean", "-f", "--", validated], {
              cwd: portalPath,
              timeoutMs: DEFAULT_GIT_CLEAN_TIMEOUT_MS,
            });
            results.reverted.push(filename);
          }
        } catch (error) {
          console.error(`Failed to revert unauthorized change to ${filename}:`, error);
        }
      }

      return results;
    } finally {
      // 4. Always release lock
      await lock.release();
    }
  }

  /**
   * Acquire exclusive lock for git operations to prevent race conditions
   */
  async acquireLock(lockFile: string): Promise<{ release: () => Promise<void> }> {
    const maxRetries = 10;
    const retryDelay = 100;

    for (let i = 0; i < maxRetries; i++) {
      try {
        // Atomic lock file creation
        await Deno.open(lockFile, {
          write: true,
          create: true,
          createNew: true, // Fails if exists
        });

        return {
          release: async () => {
            try {
              await Deno.remove(lockFile);
            } catch {
              // Ignore removal errors
            }
          },
        };
      } catch (error) {
        if (error instanceof Deno.errors.AlreadyExists) {
          // Lock held by another process
          await new Promise((r) => setTimeout(r, retryDelay));
          continue;
        }
        throw error;
      }
    }

    throw new Error("Failed to acquire git lock after maximum retries");
  }

  /**
   * Helper method to chunk array into smaller arrays
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Get latest commit SHA from git log
   */
  async getLatestCommitSha(portalPath: string): Promise<string> {
    const result = await SafeSubprocess.run("git", ["log", "-1", "--format=%H"], {
      cwd: portalPath,
      timeoutMs: DEFAULT_GIT_LOG_TIMEOUT_MS,
    });

    if (result.code !== 0) {
      throw new AgentExecutionError(`Failed to get latest commit SHA: ${result.stderr}`);
    }

    return result.stdout.trim();
  }

  /**
   * Get changed files from git diff
   */
  async getChangedFiles(portalPath: string): Promise<string[]> {
    const result = await SafeSubprocess.run("git", ["diff", "--name-only"], {
      cwd: portalPath,
      timeoutMs: DEFAULT_GIT_DIFF_TIMEOUT_MS,
    });

    if (result.code !== 0) {
      throw new AgentExecutionError(`Failed to get changed files: ${result.stderr}`);
    }

    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /**
   * Get portal configuration by alias
   */
  public getPortalConfig(alias: string): IPortalConfig | undefined {
    return this.config.portals?.find((p) => p.alias === alias);
  }

  /**
   * Is tool call budget exceeded?
   */
  checkToolCallLimit(toolCallCount: number, maxToolCalls: number): boolean {
    return toolCallCount > maxToolCalls;
  }

  /**
   * Validate review result structure
   */
  /**
   * Log execution start to IActivity Journal
   */
  async logExecutionStart(
    traceId: string,
    identityId: string,
    portal: string,
  ): Promise<void> {
    await this.logger.log({
      action: AGENT_EVENT_EXECUTION_STARTED,
      target: portal,
      actor: DEFAULT_MCP_IDENTITY_ID,
      actorType: ActorType.SERVICE,
      traceId: traceId,
      agentId: AGENT_EXECUTOR_ID,
      agentKind: AgentKind.AGENT_EXECUTOR,
      identityId: identityId,
      payload: {
        portal,
        started_at: new Date().toISOString(),
      },
    });
  }

  /**
   * Log execution completion to IActivity Journal
   */
  async logExecutionComplete(
    traceId: string,
    identityId: string,
    result: IChangesetResult,
    usage?: Opt<
      { tokens: number; cost_usd_estimate: number; prompt_tokens?: number; completion_tokens?: number },
      Reason.OptionalInput
    >,
  ): Promise<void> {
    const usagePayload = usage ?? {
      tokens: Math.max(1, Math.ceil(result.description.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN)),
      cost_usd_estimate: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
    };

    await this.logger.log({
      action: AGENT_EVENT_EXECUTION_COMPLETED,
      target: result.branch,
      actor: DEFAULT_MCP_IDENTITY_ID,
      actorType: ActorType.SERVICE,
      traceId: traceId,
      agentId: "agent-executor",
      agentKind: AgentKind.AGENT_EXECUTOR,
      identityId: identityId,
      promptTokens: usagePayload.prompt_tokens ?? Math.floor(usagePayload.tokens / 2),
      completionTokens: usagePayload.completion_tokens ?? Math.ceil(usagePayload.tokens / 2),
      costUsd: usagePayload.cost_usd_estimate,
      payload: {
        branch: result.branch,
        commit_sha: result.commit_sha,
        files_changed: result.files_changed.length,
        tool_calls: result.tool_calls,
        execution_time_ms: result.execution_time_ms,
        usage: usagePayload,
        completed_at: new Date().toISOString(),
      },
    });
  }

  /**
   * Log execution error to IActivity Journal
   */
  async logExecutionError(
    traceId: string,
    identityId: string,
    error: { type: string; message: string; trace_id?: string },
  ): Promise<void> {
    await this.logger.log({
      action: AGENT_EVENT_EXECUTION_FAILED,
      target: identityId,
      actor: DEFAULT_MCP_IDENTITY_ID,
      actorType: ActorType.SERVICE,
      traceId: traceId,
      agentId: "agent-executor",
      agentKind: AgentKind.AGENT_EXECUTOR,
      identityId: identityId,
      level: LogLevel.ERROR,
      payload: {
        error_type: error.type,
        error_message: error.message,
        failed_at: new Date().toISOString(),
      },
    });
  }

  /**
   * Log LLM generation metrics to IActivity Journal
   */
  public parseAgentResponse(
    response: string,
    context: IOutputParserContext,
    startTime: number,
  ): IChangesetResult {
    return this.outputParser.parseAgentResponse(response, context, startTime);
  }

  validateReviewResult(result: JSONValue): IChangesetResult {
    return this.outputParser.validateReviewResult(result);
  }
  async logGeneration(
    traceId: string,
    identityId: string,
    model: string,
    providerStr: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
    costUsd: number,
  ): Promise<void> {
    await this.logger.log({
      action: AGENT_GENERATION_COMPLETED,
      target: model,
      actor: DEFAULT_MCP_IDENTITY_ID,
      actorType: ActorType.SERVICE,
      traceId: traceId,
      agentId: "agent-executor",
      agentKind: AgentKind.AGENT_EXECUTOR,
      identityId: identityId,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: costUsd,
      payload: {
        model,
        provider: providerStr,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
        cost_usd: costUsd,
      },
    });
  }
}
