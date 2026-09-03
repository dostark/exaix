/**
 * @module AgentOrchestrator
 * @path packages/execution/src/agent_orchestrator.ts
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

import type { Config, IPortalConfig } from "@exaix/schemas/config.ts";
import type { HitlPolicy } from "@exaix/schemas/hitl.ts";
import type { IDatabaseService } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import { ActorType, AGENT_GENERATION_COMPLETED, AgentKind, LogLevel } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
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
import { DEFAULT_MCP_IDENTITY_ID, SESSION_BIN_CLAUDE_CODE, SESSION_BIN_OPENCODE } from "@exaix/core/types";
import type {
  IAgentExecutionOptions,
  IAgentExecutionOptionsInput,
  IChangesetCostSource,
  IChangesetResult,
  IExecutionContext,
} from "@exaix/schemas/agent_orchestrator.ts";
import type { IToolRegistry } from "@exaix/core/types";
import { AgentExecutionErrorType, ExecutionStrategyName, SecurityMode } from "@exaix/core";
import { SessionToolSchema } from "@exaix/schemas/session_delegate.ts";
import { InputValidator } from "@exaix/schemas/input_validation.ts";
import { isReadOnlyAgentCapabilities, requiresGitTracking } from "@exaix/core/func";
import type { JSONValue } from "@exaix/core";
import { StrategyRegistry } from "./strategies/strategy_registry.ts";
import { LegacyAgentStrategy } from "./strategies/legacy_strategy.ts";
import { McpAgentStrategy } from "./strategies/mcp_agent_strategy.ts";
import { ReActLoopStrategy } from "./strategies/react_loop_strategy.ts";
import { CliDelegateStrategy } from "./strategies/cli_delegate_strategy.ts";
import type { IGuardrailRunner } from "./guardrail_runner.ts";
import type { Opt, Reason, TaskType } from "@exaix/core/types";
import type { ICompactedEntry, ILoopHistoryEntry } from "./types.ts";
import type { IPromptBudget } from "@exaix/schemas/prompt_budget.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import { ContextBudgetManager, type IContextBudgetManager } from "./context/context_budget_manager.ts";
import type { ISnapshotStore } from "./context/snapshot_store.ts";
import { ExecutionContextService } from "./execution_context_service.ts";
import { BlueprintService } from "./blueprint_service.ts";
import { PromptBuilder } from "./prompt_builder.ts";
import { resolveEffectiveSkillTools } from "./skill_tools_derivation.ts";
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
  /** Per-action HITL governance rules. Resolved by ExecutionLoop for ToolRegistry path. */
  hitl?: HitlPolicy;
}

/** Optional configuration for AgentOrchestrator. */
export interface IAgentOrchestratorOptions {
  guardrailRunner?: IGuardrailRunner;
  /** Request-level IModelIntent fields override blueprint values. */
  requestIntent?: Partial<IModelIntent>;
  /** The caller's highest-confidence skill match's triggers.task_types, in priority order
   *  (first = most confident). AgentOrchestrator has no SkillsService dependency; a caller
   *  that already matched skills (e.g. AgentRunner) supplies this for the derivation chain. */
  topSkillTaskTypes?: TaskType[];
  /** The `tools` declared by every skill matched for this execution, one array per matched
   *  skill. A caller that already matched skills (e.g. PlanExecutor) supplies this so
   *  executeStep can union them and intersect with the blueprint's permitted_tools. */
  matchedSkillTools?: Array<string[] | undefined>;
}

/** Dependencies for AgentOrchestrator constructor. */
export interface IAgentOrchestratorDeps {
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
  options?: IAgentOrchestratorOptions;
  modelResolver?: ModelResolver;
  /** Externally-owned set of files already legitimately written by an earlier step of the
   *  same plan/flow run, shared across per-call orchestrator instances so a later step's
   *  audit doesn't flag them. Defaults to a fresh, empty Set when omitted. */
  planWrittenFiles?: Set<string>;
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

/** Orchestrator and strategy dispatcher for agent execution — delegates blueprint
 *  loading, prompt building, budget/context, git audit, output parsing, and loop history
 *  to the injected services named in the module header. */
export class AgentOrchestrator {
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
  private readonly options?: IAgentOrchestratorOptions;
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

  /** Files written by any step of the current plan through legitimate portal-scoped
   *  tools; the audit runs against the CUMULATIVE worktree, so `deps.planWrittenFiles`
   *  lets a caller share this Set across the fresh-per-step orchestrators a flow builds. */
  private readonly planWrittenFiles: Set<string>;

  /** Exposes current prompt budget to IReActLoopExecutor. */
  public get currentPromptBudget(): IPromptBudget | undefined {
    return this.ctx.currentPromptBudget;
  }

  /** Exposes context budget manager to IReActLoopExecutor. */
  public get contextBudgetManager(): IContextBudgetManager | undefined {
    return this.ctx.contextBudgetManager;
  }

  /** Exposes snapshot store to async compaction tier. */
  public get snapshotStore(): ISnapshotStore | undefined {
    return this.ctx.snapshotStore;
  }

  /** Budget pressure logger forwarded to IReActLoopExecutor. */
  public get budgetLogger(): IEventLogger {
    return this.logger;
  }

  /** Optional guardrail screening runner forwarded to IReActLoopExecutor. Undefined in
   *  Solo (the ReAct seam is a no-op); paid editions inject one via the edition composer. */
  public get guardrailRunner(): IGuardrailRunner | undefined {
    return this._guardrailRunner;
  }

  constructor(deps: IAgentOrchestratorDeps) {
    this.config = deps.config;
    this.db = deps.db;
    this.logger = deps.logger;
    this.pathResolver = deps.pathResolver;
    this.planWrittenFiles = deps.planWrittenFiles ?? new Set<string>();
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
      contextBudgetManager: new ContextBudgetManager(undefined, undefined, undefined, this.logger),
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
      {
        guardrailRunner: deps.guardrailRunner,
        aci: {
          enabled: this.config.agents?.inject_aci_docs,
          promptMaxChars: this.config.agents?.aci_doc_prompt_max_chars,
        },
      },
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
      if (this.config.cli_delegate?.enabled) {
        this.strategyRegistry.register(this.buildCliDelegateStrategy(this.config.cli_delegate));
      }
    }
  }

  /** Builds CliDelegateStrategy from the [cli_delegate] config block. Prefers the
   *  ToolRegistry's resolved baseDir over the portal's static config path — in a worktree
   *  run, ToolRegistry alone knows the worktree checkout path. */
  private buildCliDelegateStrategy(cliDelegateConfig: NonNullable<Config["cli_delegate"]>): CliDelegateStrategy {
    const bin = cliDelegateConfig.bin_overrides?.[0] ??
      (cliDelegateConfig.tool === SessionToolSchema.enum["claude-code"]
        ? SESSION_BIN_CLAUDE_CODE
        : SESSION_BIN_OPENCODE);
    return new CliDelegateStrategy({
      tool: cliDelegateConfig.tool,
      bin,
      model: cliDelegateConfig.model,
      resolvePortalPath: (portalAlias) =>
        this._toolRegistry?.getBaseDir() ?? this.getPortalConfig(portalAlias)?.target_path,
    });
  }

  public get toolRegistry(): IToolRegistry | undefined {
    return this._toolRegistry;
  }

  public set toolRegistry(registry: IToolRegistry | undefined) {
    this._toolRegistry = registry;
  }

  /** Loop history of completed execution steps, delegated to HistoryManager. */
  public get loopHistory(): Array<ILoopHistoryEntry | ICompactedEntry> {
    return this.historyManager.loopHistory;
  }

  compactLoopHistory(
    keepLastN: Opt<number, Reason.SensibleDefault>,
  ): Promise<void> {
    return this.historyManager.compactLoopHistory(keepLastN);
  }

  private async _checkLoopHistoryBudget(): Promise<void> {
    if (!this.ctx.currentPromptBudget) return;
    await this.historyManager.checkBudget(this.ctx.currentPromptBudget);
  }

  /** Queries recent activities for a trace ID; used by sub-agents via
   *  parent_context_query to understand execution context. */
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

  /** Sets execution context for agent operations; changes working directory to it. */
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

  /** Executes `fn` within execution context, then restores — even if `fn` throws. */
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

  /** Disposes all resources (strategy signal listeners, etc.); call when no longer needed. */
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

  /** True if the agent's write capabilities require branch creation and commit tracking. */
  requiresGitTracking(blueprint: IAgentFileBlueprint): boolean {
    return requiresGitTracking(blueprint.capabilities, blueprint.permitted_tools);
  }

  /** True if the agent has no write capabilities (inverse of requiresGitTracking). */
  isReadOnlyAgent(blueprint: IAgentFileBlueprint): boolean {
    return isReadOnlyAgentCapabilities(blueprint.capabilities, blueprint.permitted_tools);
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
  /** Bridges blueprint-level permitted_tools/allowed_paths onto per-call options, then
   *  narrows permitted_tools to matched skills' tools intersected with the identity's own
   *  allowlist — a skill can only narrow, never grant a tool the identity doesn't allow. */
  private applyBlueprintToolScope(
    blueprint: IAgentFileBlueprint,
    options: IAgentExecutionOptions,
  ): void {
    if (blueprint.permitted_tools) {
      options.permitted_tools = blueprint.permitted_tools;
    }
    if (blueprint.allowed_paths) {
      options.allowed_paths = blueprint.allowed_paths;
    }
    if (this.options?.matchedSkillTools) {
      options.permitted_tools = resolveEffectiveSkillTools(
        this.options.matchedSkillTools,
        options.permitted_tools,
      );
    }
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

    const startTime = Date.now();

    // Validate portal exists
    const portal = this.config.portals?.find((p) => p.alias === options.portal);
    if (!portal) {
      throw new Error(`Portal not found: ${options.portal}`);
    }

    // Validate agent has permissions (check before loading blueprint)
    if (!this.permissions.checkAgentAllowed(options.portal, options.agent_role ?? "").allowed) {
      throw new Error(
        `Identity not allowed to access portal: ${options.agent_role} -> ${options.portal}`,
      );
    }

    // Load blueprint — capabilities array drives strategy dispatch (MCP > ReAct > Legacy).
    const _blueprint = await this.loadBlueprint(options.agent_role ?? "");
    const modelId = this.resolveModelId(_blueprint);
    await this.ctx.allocateBudget(
      modelId,
      options.request_analysis as IRequestAnalysis | undefined,
    );

    // Log execution start
    await this.logExecutionStart(
      context.trace_id,
      options.agent_role ?? "",
      options.portal,
    );

    const strategyName = this.resolveStrategyName(_blueprint, options);

    this.applyBlueprintToolScope(_blueprint, options);

    // Forward this blueprint's own hitl.require_secondary_approval rules to the
    // ToolRegistry the resolved strategy will call execute() on, so the blueprint's
    // approval rules gate every strategy's tool calls, same as identity.hitl.
    this.toolRegistry?.setHitlBlueprintRules?.(_blueprint.hitl?.require_secondary_approval ?? []);

    try {
      const strategy = this.strategyRegistry!.resolve(strategyName);
      // Forward resolved per-call options (thinking/effort) to the strategy
      if (this._resolvedCallOptions && "callOptions" in strategy) {
        (strategy as { callOptions?: IModelCallOptions }).callOptions = this._resolvedCallOptions;
      }
      const validated = await strategy.execute(_blueprint, context, options);

      // Real usage from the strategy, when reported; otherwise undefined — no heuristic
      // cost estimation, since output tokens are unknowable pre-call and input-side
      // cache-tier pricing is unpopulated data.
      const usage = validated.usage
        ? {
          tokens: validated.usage.prompt_tokens + validated.usage.completion_tokens,
          cost_usd_estimate: validated.usage.cost_usd,
          prompt_tokens: validated.usage.prompt_tokens,
          completion_tokens: validated.usage.completion_tokens,
          cache_read_tokens: validated.usage.cache_read_tokens,
          cache_creation_tokens: validated.usage.cache_creation_tokens,
          reasoning_tokens: validated.usage.reasoning_tokens,
          cost_source: validated.usage.cost_source,
        }
        : undefined;

      // Real SHA and Audit
      const portalPath = this.resolveAuditPortalPath(portal);

      // 1. Capture real SHA
      validated.commit_sha = await this.getPortalHeadSha(portalPath);

      // Perform Audit. Authorize allowed_paths plus every file an EARLIER step already
      // wrote through legitimate tools; when allowed_paths is declared, this step's own
      // files_changed must NOT widen it, or a self-reporting agent could rubber-stamp any path.
      const declaresAllowedPaths = (options.allowed_paths?.length ?? 0) > 0;
      const authorizedPaths = declaresAllowedPaths
        ? [...(options.allowed_paths ?? []), ...this.planWrittenFiles]
        : [...this.planWrittenFiles, ...(validated.files_changed ?? [])];
      const unauthorizedChanges = await this.auditGitChanges(
        portalPath,
        authorizedPaths,
      );

      if (unauthorizedChanges.length > 0) {
        // Revert if breach detected
        await this.revertUnauthorizedChanges(portalPath, unauthorizedChanges);

        // Log security violation
        await this.logger.error(AGENT_EVENT_SECURITY_VIOLATION, context.trace_id, {
          portal: options.portal,
          unauthorized_files: unauthorizedChanges,
          agent_role: options.agent_role,
        });

        throw new AgentExecutionError(
          `Security violation: Unauthorized file modifications detected in portal '${options.portal}'`,
          AgentExecutionErrorType.SECURITY_VIOLATION,
        );
      }

      // Audit passed: this step's writes are now legitimate and accumulate for later
      // steps' audits (see planWrittenFiles above) — a self-reported files_changed entry
      // outside allowed_paths never reaches here since the audit above would have thrown.
      for (const file of validated.files_changed ?? []) this.planWrittenFiles.add(file);

      // Track step in loop history for potential summarization. Falls back to a
      // char-count heuristic over the full step context when no strategy-reported usage
      // exists; loop-history token tracking is unrelated to cost estimation.
      const loopHistoryTokens = usage?.tokens ?? Math.max(
        1,
        this.ctx.estimateTokensSync(
          _blueprint.systemPrompt + context.request + context.plan + validated.description,
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
        options.agent_role || "unknown",
        validated,
        usage,
        Date.now() - startTime,
      );

      return validated;
    } catch (error) {
      // Log error
      await this.logExecutionError(context.trace_id, options.agent_role ?? "", {
        type: AgentExecutionErrorType.EXECUTION_ERROR,
        message: error instanceof Error ? error.message : String(error),
        trace_id: context.trace_id,
      });

      throw error;
    } finally {
      this.ctx.clearBudget();
    }
  }

  /** Logs output from an agent subprocess. */
  public async logAgentOutput(traceId: string, output: string): Promise<void> {
    await this.logger.info(DomainEventType.AgentOutput, "subprocess", { output }, traceId);
  }

  private resolveModelId(blueprint: IAgentFileBlueprint): string {
    return this.blueprintService.resolveModelId(blueprint);
  }

  /** Builds execution prompt for LLM agent. Delegates to PromptBuilder. */
  buildExecutionPrompt(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
  ): Promise<string> {
    const modelId = this.resolveModelId(blueprint);
    const tools = this._toolRegistry?.getTools();
    return this.promptBuilder.buildExecutionPrompt(blueprint, context, options, modelId, tools);
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

  /** Audits git changes to detect unauthorized modifications. */
  auditGitChanges(portalPath: string, authorizedFiles: string[]): Promise<string[]> {
    return this.gitAuditService.auditGitChanges(portalPath, authorizedFiles);
  }

  getPortalHeadSha(portalPath: string): Promise<string> {
    return this.gitAuditService.getPortalHeadSha(portalPath);
  }

  public validateFilePath(filePath: string, portalPath: string): string | null {
    return this.gitAuditService.validateFilePath(filePath, portalPath);
  }

  /** Reverts unauthorized changes in hybrid mode via git checkout. */
  revertUnauthorizedChanges(portalPath: string, unauthorizedFiles: string[]): Promise<void> {
    return this.gitAuditService.revertUnauthorizedChanges(portalPath, unauthorizedFiles);
  }

  /**
   * Get portal configuration by alias
   */
  public getPortalConfig(alias: string): IPortalConfig | undefined {
    return this.config.portals?.find((p) => p.alias === alias);
  }

  /** Resolves the directory executeStep's audit checks: prefers ToolRegistry's resolved
   *  baseDir (worktree checkout) over the static portal path, since a step's real writes
   *  land in the worktree and auditing the mounted portal would miss them. */
  private resolveAuditPortalPath(portal: IPortalConfig): string {
    const toolRegistryBaseDir = this._toolRegistry?.getBaseDir();
    return toolRegistryBaseDir && toolRegistryBaseDir !== this.config.system.root
      ? toolRegistryBaseDir
      : portal.target_path;
  }

  /** Resolves executeStep's dispatch strategy. `options.strategy`, when present, is an
   *  unconditional override, never cross-checked against `blueprint.capabilities`. Absent
   *  one: prefer MCP or ReAct if specified, fallback to legacy; CLI_DELEGATE is opt-in only. */
  private resolveStrategyName(
    blueprint: IAgentFileBlueprint,
    options: IAgentExecutionOptions,
  ): ExecutionStrategyName {
    if (options.strategy) {
      return options.strategy;
    }
    if (blueprint.capabilities.includes(ExecutionStrategyName.MCP)) {
      return ExecutionStrategyName.MCP;
    }
    if (blueprint.capabilities.includes(ExecutionStrategyName.CLI_DELEGATE)) {
      return ExecutionStrategyName.CLI_DELEGATE;
    }
    if (blueprint.capabilities.includes(ExecutionStrategyName.REACT)) {
      return ExecutionStrategyName.REACT;
    }
    return ExecutionStrategyName.LEGACY;
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
    agentRole: string,
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
      agentRole: agentRole,
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
    agentRole: string,
    result: IChangesetResult,
    usage?: Opt<
      {
        tokens: number;
        cost_usd_estimate: number;
        prompt_tokens?: number;
        completion_tokens?: number;
        cache_read_tokens?: number;
        cache_creation_tokens?: number;
        reasoning_tokens?: number;
        cost_source?: IChangesetCostSource;
      },
      Reason.OptionalInput
    >,
    /** Real per-step wall-clock duration around executeStep, distinct from the
     *  strategy-internal execution_time_ms already on `result`. */
    durationMs?: Opt<number, Reason.OptionalInput>,
  ): Promise<void> {
    const usagePayload = usage ?? {
      tokens: Math.max(1, this.ctx.estimateTokensSync(result.description)),
      cost_usd_estimate: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      // No strategy reported usage at all — consistent with "no real figure was ever
      // reported", the fallback defaults cost_source to predicted alongside its
      // existing $0/token-estimate defaults.
      cost_source: "predicted" as const,
    };

    await this.logger.log({
      action: AGENT_EVENT_EXECUTION_COMPLETED,
      target: result.branch,
      actor: DEFAULT_MCP_IDENTITY_ID,
      actorType: ActorType.SERVICE,
      traceId: traceId,
      agentId: "agent-executor",
      agentKind: AgentKind.AGENT_EXECUTOR,
      agentRole: agentRole,
      promptTokens: usagePayload.prompt_tokens ?? Math.floor(usagePayload.tokens / 2),
      completionTokens: usagePayload.completion_tokens ?? Math.ceil(usagePayload.tokens / 2),
      costUsd: usagePayload.cost_usd_estimate,
      payload: {
        branch: result.branch,
        commit_sha: result.commit_sha,
        files_changed: result.files_changed.length,
        tool_calls: result.tool_calls,
        execution_time_ms: result.execution_time_ms,
        duration_ms: durationMs,
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
    agentRole: string,
    error: { type: string; message: string; trace_id?: string },
  ): Promise<void> {
    await this.logger.log({
      action: AGENT_EVENT_EXECUTION_FAILED,
      target: agentRole,
      actor: DEFAULT_MCP_IDENTITY_ID,
      actorType: ActorType.SERVICE,
      traceId: traceId,
      agentId: "agent-executor",
      agentKind: AgentKind.AGENT_EXECUTOR,
      agentRole: agentRole,
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
    agentRole: string,
    model: string,
    providerStr: string,
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      costUsd: number;
      /** Real wall-clock duration of this individual provider.generate() call, ms. */
      durationMs?: Opt<number, Reason.OptionalInput>;
    },
  ): Promise<void> {
    await this.logger.log({
      action: AGENT_GENERATION_COMPLETED,
      target: model,
      actor: DEFAULT_MCP_IDENTITY_ID,
      actorType: ActorType.SERVICE,
      traceId: traceId,
      agentId: "agent-executor",
      agentKind: AgentKind.AGENT_EXECUTOR,
      agentRole: agentRole,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: usage.costUsd,
      payload: {
        model,
        provider: providerStr,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
        cost_usd: usage.costUsd,
        duration_ms: usage.durationMs,
      },
    });
  }
}
