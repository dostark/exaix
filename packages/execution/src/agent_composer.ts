/**
 * @module AgentComposer
 * @path packages/execution/src/agent_composer.ts
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
import type { IDatabaseService, ISkillsService } from "@exaix/core/types";
import { createSkillOperationContext, SkillUnavailableError } from "@exaix/core/skills";
import type { IEventLogger } from "@exaix/core/logger";
import { canonicalizeToolName, TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import type { IWorkspaceExecutionContext, PathResolver, PortalPermissionsService } from "@exaix/portal";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { getProviderFailureReason } from "@exaix/ai/errors.ts";
import type { ModelResolver } from "@exaix/ai";
import type { IFixedModelClient, IModelCallOptions } from "@exaix/schemas";
import { AGENT_EVENT_SECURITY_VIOLATION, type IAllocationHints } from "@exaix/core";
import { SESSION_BIN_CLAUDE_CODE, SESSION_BIN_CODEX, SESSION_BIN_OPENCODE } from "@exaix/core/types";
import type {
  IAgentExecutionOptions,
  IAgentExecutionOptionsInput,
  IChangesetResult,
  IExecutionContext,
} from "@exaix/schemas/agent_composer.ts";
import type { IToolRegistry } from "@exaix/core/types";
import { AgentExecutionErrorType, ExecutionStrategyName, SecurityMode } from "@exaix/core";
import { SessionToolSchema } from "@exaix/schemas/session_delegate.ts";
import { InputValidator } from "@exaix/schemas/input_validation.ts";
import { isReadOnlyAgentCapabilities, requiresGitTracking } from "@exaix/core/func";
import type { JSONValue } from "@exaix/core";
import { StrategyRegistry } from "./strategies/strategy_registry.ts";
import { McpAgentStrategy } from "./strategies/mcp_agent_strategy.ts";
import { ReActLoopStrategy } from "./strategies/react_loop_strategy.ts";
import { CliDelegateStrategy, type IRunCliDelegateProcess } from "./strategies/cli_delegate_strategy.ts";
import type { IGuardrailRunner } from "./guardrail_runner.ts";
import type { IDogfoodContextPort, Opt, Reason, TaskType } from "@exaix/core/types";
import type { ICompactedEntry, ILoopHistoryEntry } from "./types.ts";
import type { IPromptBudget } from "@exaix/schemas/prompt_budget.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type {
  EffortDeclaration,
  EffortTier,
  IModelIntent,
  IToolsRoundPolicy,
  ModelSize,
  SessionTool,
  ThinkingDeclaration,
} from "@exaix/schemas";
import { EFFORT_MAX_TOKENS, EffortResolver } from "@exaix/ai";
import type { IEffortDeclarationPair, IEffortResolution, IEffortResolver } from "@exaix/ai";

import type { IProjectedCallOptions } from "@exaix/ai";
import { providerSupportsNativeConversation } from "./native_tool_turns.ts";
import { PLANNING_TOOL_CALL_OVERHEAD_TOKENS } from "@exaix/core";
import { ContextBudgetManager, type IContextBudgetManager } from "./context/context_budget_manager.ts";
import type { ISnapshotStore } from "./context/snapshot_store.ts";
import { ExecutionContextService } from "./execution_context_service.ts";
import { type IGenerationUsage, logGenerationCompleted } from "./generation_log.ts";
import { BlueprintService } from "./blueprint_service.ts";
import { PromptBuilder } from "./prompt_builder.ts";
import { readDelegateProviderEnv } from "@exaix/session/delegate_provider_env.ts";
import { createPinnedSkillPrompt, type IPinnedSkillPrompt } from "./skill_pin_transport.ts";
import { resolveEffectiveSkillTools } from "./skill_tools_derivation.ts";
import { AgentComposerAudit, type IComposerUsage } from "./agent_composer_audit.ts";
import { AgentComposerEffort } from "./agent_composer_effort.ts";
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
  /** Blueprint-declared effort ("auto" defers to EffortResolver at execution resolution). */
  effort?: EffortDeclaration;
  /** Blueprint-declared thinking ("auto" defers to EffortResolver at execution resolution). */
  thinking?: ThinkingDeclaration;
  /** Blueprint model size tier (S/M/L/XL) — caps heuristic effort resolution for small
   *  models on the execution path too. */
  modelSize?: ModelSize;
}

/** Optional configuration for AgentComposer. */
export interface IAgentComposerOptions {
  guardrailRunner?: IGuardrailRunner;
  /** Request-level IModelIntent fields override blueprint values. */
  requestIntent?: Partial<IModelIntent>;
  /** The request's declaration-time effort and thinking pair ("auto" allowed), passed by PlanExecutor.
   *  The execution path resolves it after provider selection. */
  requestDeclaration?: IEffortDeclarationPair;
  /** The caller's highest-confidence skill match's triggers.task_types, in priority order
   *  (first = most confident). AgentComposer has no SkillsService dependency; a caller
   *  that already matched skills (e.g. AgentRunner) supplies this for the derivation chain. */
  topSkillTaskTypes?: TaskType[];
  /** The `tools` declared by every skill matched for this execution, one array per matched
   *  skill. A caller that already matched skills (e.g. PlanExecutor) supplies this so
   *  executeStep can union them and intersect with the blueprint's permitted_tools. */
  matchedSkillTools?: Array<string[] | undefined>;
  /** The effort/thinking floor declared by every skill matched for this execution, one
   *  entry per matched skill. A caller that already matched skills supplies this so
   *  executeStep can include skill floors in its resolution (floors only raise). */
  matchedSkillFloors?: Array<{ skillId: string; effort?: EffortTier; thinking?: boolean }>;
  /** The provider type and model of the injected provider. Model resolution then reports this
   *  client, because execution cannot switch to another one. */
  fixedClient?: IFixedModelClient;
}

/** Dependencies for AgentComposer constructor. */
interface IAgentComposerDeps {
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
  options?: IAgentComposerOptions;
  modelResolver?: ModelResolver;
  /** Externally-owned set of files already legitimately written by an earlier step of the
   *  same plan/flow run, shared across per-call orchestrator instances so a later step's
   *  audit doesn't flag them. Defaults to a fresh, empty Set when omitted. */
  planWrittenFiles?: Set<string>;
  /** Optional dogfood bounded-context port passed through to CliDelegateStrategy; absent
   *  for every non-dogfood/disabled-config caller, which preserves existing behavior. */
  contextPort?: Opt<IDogfoodContextPort, Reason.OptionalDependency>;
  /** Agent-role blueprint IDs trusted to activate contextPort, passed through to
   *  CliDelegateStrategy. Mandatory whenever contextPort is set. */
  trustedAgentRoles?: Opt<ReadonlySet<string>, Reason.OptionalDependency>;
  /** The EffortResolver for execution-path resolution. Defaults to a fresh EffortResolver. */
  effortResolver?: IEffortResolver;
  /** Binds a strategy cli_delegate step to a session tool and model from a cli-delegate catalog service.
   *  The `buildCliDelegateStrategy` call prefers this binding over the config block. It does so even when the config flag is off. */
  cliDelegateBinding?: { tool: SessionTool; model: string };
  /** Test-only escape hatch, a fake subprocess runner for the cli-delegate strategy.
   *  It stops a bound delegate test from spawning a real tool.
   *  Production never sets this flag. */
  cliDelegateRun?: Opt<IRunCliDelegateProcess, Reason.TestOverride>;
  /** Resolves the pinned skill revisions of a plan step. Absent only for callers that never pin skills. */
  skills?: Opt<ISkillsService, Reason.OptionalDependency>;
  /** Reads the resolved tool-round policy for each ReAct model turn. Absent uses the schema defaults. */
  toolsRoundPolicy?: () => IToolsRoundPolicy;
}

/** Explicit binary mapping for the supported cli-delegate session tools. Anything else
 *  (cursor, vscode, a future tool) has no binary and fails preflight. */
function delegateBinary(tool: SessionTool): string | undefined {
  if (tool === SessionToolSchema.enum["claude-code"]) return SESSION_BIN_CLAUDE_CODE;
  if (tool === SessionToolSchema.enum.opencode) return SESSION_BIN_OPENCODE;
  if (tool === SessionToolSchema.enum.codex) return SESSION_BIN_CODEX;
  return undefined;
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

/** Orchestrator and strategy dispatcher for agent execution. It delegates blueprint loading, prompt building,
 *  budgets, git audit, output parsing and loop history to the injected services. */
export class AgentComposer {
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
  private readonly options?: IAgentComposerOptions;
  private modelResolver?: ModelResolver;
  /** Resolver for execution-path effort and thinking. Injected once so overrides and test substitutes reach this path. */
  private readonly effortResolver: IEffortResolver;
  private blueprintService: BlueprintService;
  private promptBuilder: PromptBuilder;
  private gitAuditService: GitAuditService;
  private readonly audit: AgentComposerAudit;
  private readonly effort: AgentComposerEffort;
  private outputParser: OutputParser;
  private historyManager: HistoryManager;
  private reActAdapter: ReActLoopAdapter;
  private ctx: ExecutionContextService;
  private readonly contextPort?: IDogfoodContextPort;
  private readonly trustedAgentRoles?: ReadonlySet<string>;
  private readonly skills?: ISkillsService;

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

  constructor(deps: IAgentComposerDeps) {
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
    this.contextPort = deps.contextPort;
    this.trustedAgentRoles = deps.trustedAgentRoles;
    this.skills = deps.skills;
    this.options = deps.options;
    this.modelResolver = deps.modelResolver;
    this.effortResolver = deps.effortResolver ?? new EffortResolver();
    this.blueprintService = deps.blueprintService ??
      new BlueprintService(this.config, this.logger, deps.modelResolver, deps.options);
    this.ctx = deps.executionContext ?? new ExecutionContextService(this.config, this.logger, {
      promptBudgetAllocator: undefined,
      contextCache: undefined,
      tokenizer: undefined,
      contextBudgetManager: new ContextBudgetManager(undefined, undefined, undefined, this.logger),
      snapshotStore: undefined,
    });
    this.audit = new AgentComposerAudit({
      logger: this.logger,
      estimateTokens: (text) => this.ctx.estimateTokensSync(text),
    });
    this.effort = new AgentComposerEffort({
      config: this.config,
      logger: this.logger,
      effortResolver: this.effortResolver,
      provider: this.provider,
      options: this.options,
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
        maxIterations: this.config.agents?.max_iterations,
        toolsRoundPolicy: deps.toolsRoundPolicy,
      },
    );
    if (deps.options?.guardrailRunner) {
      this._guardrailRunner = deps.options.guardrailRunner;
    }
    // If no registry provided, create one and register core strategies
    if (!this.strategyRegistry) {
      this.strategyRegistry = new StrategyRegistry();
      this.strategyRegistry.register(new ReActLoopStrategy(this.reActAdapter, this.provider));
      this.strategyRegistry.register(new McpAgentStrategy(this));
      if (deps.cliDelegateBinding || this.config.cli_delegate?.enabled) {
        this.strategyRegistry.register(
          this.buildCliDelegateStrategy(this.config.cli_delegate, deps.cliDelegateBinding, deps.cliDelegateRun),
        );
      }
    }
  }

  /** Builds CliDelegateStrategy from the [cli_delegate] config block. A bound cli-delegate service beats the block,
   *  even when `[cli_delegate].enabled` is false. Only claude-code, opencode and codex have a binary.
   *  The ToolRegistry's baseDir beats the portal's static config path. */
  private buildCliDelegateStrategy(
    cliDelegateConfig?: Opt<NonNullable<Config["cli_delegate"]>, Reason.OptionalDependency>,
    cliDelegateBinding?: Opt<{ tool: SessionTool; model: string }, Reason.OptionalDependency>,
    cliDelegateRun?: Opt<IRunCliDelegateProcess, Reason.TestOverride>,
  ): CliDelegateStrategy {
    const tool = cliDelegateBinding?.tool ?? cliDelegateConfig?.tool;
    if (!tool) {
      throw new Error("cli-delegate strategy requires a tool from config.cli_delegate or a bound cli-delegate service");
    }
    const bin = cliDelegateConfig?.bin_overrides?.[0] ?? delegateBinary(tool);
    if (!bin) {
      throw new Error(`Unsupported cli-delegate tool: ${tool}`);
    }
    const providerEnv = cliDelegateConfig?.provider
      ? readDelegateProviderEnv(cliDelegateConfig.provider, tool, (name) => Deno.env.get(name))
      : undefined;
    return new CliDelegateStrategy({
      tool,
      bin,
      model: cliDelegateBinding?.model ?? cliDelegateConfig?.model,
      effort: cliDelegateConfig?.effort,
      providerEnv,
      resolvePortalPath: (portalAlias) =>
        this._toolRegistry?.getBaseDir() ?? this.getPortalConfig(portalAlias)?.target_path,
      contextPort: this.contextPort,
      trustedAgentRoles: this.trustedAgentRoles,
      ...(cliDelegateRun ? { run: cliDelegateRun } : {}),
    });
  }

  public get toolRegistry(): IToolRegistry | undefined {
    return this._toolRegistry;
  }

  public set toolRegistry(registry: Opt<IToolRegistry, Reason.OptionalDependency>) {
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
  async loadBlueprint(
    rawAgentName: string,
    traceId?: Opt<string, Reason.TraceAbsent>,
  ): Promise<IAgentFileBlueprint> {
    const result = await this.blueprintService.loadBlueprint(rawAgentName, traceId);
    this._resolvedCallOptions = result.resolvedCallOptions;
    return result.blueprint;
  }

  /** Rebuilds _resolvedCallOptions from the resolution. The final thinking and effort replace the ModelResolver values.
   *  max_tokens is EFFORT_MAX_TOKENS[effort] only when the governing declaration was concrete. */
  private applyEffortResolution(resolution: IEffortResolution, projection: IProjectedCallOptions): void {
    this._resolvedCallOptions = this._resolvedCallOptions ?? {};
    delete this._resolvedCallOptions.thinking;
    delete this._resolvedCallOptions.effort;
    delete this._resolvedCallOptions.max_tokens;
    if (projection.thinking !== undefined) this._resolvedCallOptions.thinking = projection.thinking;
    if (projection.effort !== undefined) this._resolvedCallOptions.effort = projection.effort;
    if (resolution.effort !== undefined) {
      if (resolution.concreteDeclaration) {
        this._resolvedCallOptions.max_tokens = EFFORT_MAX_TOKENS[resolution.effort];
      }
    }
  }

  /**
   * Sanitize system prompt to prevent XSS and injection attacks
   */
  public static sanitizePrompt(prompt: string): string {
    return BlueprintService.sanitizePrompt(prompt);
  }
  /** Bridges blueprint permitted_tools and allowed_paths onto per-call options.
   *  It narrows permitted_tools to the matched skills' tools that the agent role also allows. A skill can narrow, never grant.
   *  Both sides are canonicalized first. A role listing `grep_search` still matches a skill declaring `grep`. */
  private applyBlueprintToolScope(
    blueprint: IAgentFileBlueprint,
    options: IAgentExecutionOptions,
  ): void {
    if (options.permitted_tools !== undefined) {
      options.permitted_tools = options.permitted_tools.map(canonicalizeToolName);
    }
    if (blueprint.permitted_tools) {
      options.permitted_tools = blueprint.permitted_tools.map(canonicalizeToolName);
    }
    if (blueprint.allowed_paths) {
      options.allowed_paths = blueprint.allowed_paths;
    }
    if (this.options?.matchedSkillTools) {
      options.permitted_tools = resolveEffectiveSkillTools(
        this.options.matchedSkillTools.map((tools) => tools?.map(canonicalizeToolName)),
        options.permitted_tools,
      );
    }
  }

  /** Renders the plan's pinned skills from their stored snapshots. Absent pins keep live behavior.
   *  A pin that cannot resolve fails the step before any strategy runs. */
  private async resolvePinnedSkillPrompt(
    context: IExecutionContext,
    options: IAgentExecutionOptions,
  ): Promise<IPinnedSkillPrompt | null> {
    const pins = options.resolved_skills ?? context.resolved_skills;
    if (!pins || pins.length === 0) return null;
    if (!this.skills) throw new SkillUnavailableError("", "Pinned skills cannot be replayed without a skills service");
    const operation = createSkillOperationContext({
      agentRole: options.agent_role ?? "unknown",
      portal: options.portal,
      traceId: context.trace_id,
      requestId: context.request_id,
      configGeneration: this.skills.currentConfigGeneration(),
    });
    return await createPinnedSkillPrompt(this.skills, pins, operation);
  }

  /**
   * Execute a plan step using agent via MCP
   */
  async executeStep(
    rawContext: IExecutionContext,
    rawOptions: IAgentExecutionOptionsInput,
  ): Promise<IChangesetResult> {
    const { context, options } = this.validatedStepInputs(rawContext, rawOptions);
    const startTime = Date.now();

    try {
      const portal = this.resolveStepPortal(options);
      const _blueprint = await this.loadBlueprint(options.agent_role ?? "", context.trace_id);
      const pinnedSkills = await this.resolvePinnedSkillPrompt(context, options);
      const strategyName = this.resolveStrategyName(_blueprint, options);
      await this.prepareStepBudget(_blueprint, options, context.trace_id, pinnedSkills, strategyName);

      await this.logExecutionStart(context.trace_id, options.agent_role ?? "", options.portal);
      this.applyBlueprintToolScope(_blueprint, options);
      this.toolRegistry?.setHitlBlueprintRules?.(_blueprint.hitl?.require_secondary_approval ?? []);

      const strategy = this.selectStrategy(strategyName);
      const validated = await strategy.execute(_blueprint, context, options, pinnedSkills);
      const usage = this.usageReportOf(validated);

      const portalPath = this.resolveAuditPortalPath(portal);
      validated.commit_sha = await this.getPortalHeadSha(portalPath);

      const unauthorizedChanges = await this.auditGitChanges(
        portalPath,
        this.authorizedPathsOf(options, validated),
      );
      if (unauthorizedChanges.length > 0) {
        await this.rejectUnauthorizedChanges(
          portalPath,
          options.portal,
          options.agent_role ?? "",
          context,
          unauthorizedChanges,
        );
      }

      for (const file of validated.files_changed ?? []) this.planWrittenFiles.add(file);
      this.recordStepHistory(validated, _blueprint, context, usage);
      await this._checkLoopHistoryBudget();
      await this.logExecutionComplete(
        context.trace_id,
        options.agent_role || "unknown",
        validated,
        usage,
        Date.now() - startTime,
      );
      return validated;
    } catch (error) {
      const providerReasonCode = error instanceof Error ? getProviderFailureReason(error) : undefined;
      await this.logExecutionError(context.trace_id, options.agent_role ?? "", {
        type: AgentExecutionErrorType.EXECUTION_ERROR,
        message: error instanceof Error ? error.message : String(error),
        trace_id: context.trace_id,
        ...(providerReasonCode ? { providerReasonCode } : {}),
      });
      throw error;
    } finally {
      this.ctx.clearBudget();
    }
  }

  /** Validates one step's inputs before any journal or budget state exists. */
  private validatedStepInputs(
    rawContext: IExecutionContext,
    rawOptions: IAgentExecutionOptionsInput,
  ): { context: IExecutionContext; options: IAgentExecutionOptions } {
    const context = InputValidator.validateExecutionContext(rawContext);
    const options: IAgentExecutionOptions = InputValidator.validateAgentExecutionOptions(rawOptions);
    return { context, options };
  }

  /** Resolves the target portal and checks the role, inside the step's failure and cleanup boundary. */
  private resolveStepPortal(options: IAgentExecutionOptions): IPortalConfig {
    const portal = this.config.portals?.find((p) => p.alias === options.portal);
    if (!portal) throw new Error(`Portal not found: ${options.portal}`);
    if (!this.permissions.checkAgentAllowed(options.portal, options.agent_role ?? "").allowed) {
      throw new Error(`Agent role not allowed to access portal: ${options.agent_role} -> ${options.portal}`);
    }
    return portal;
  }

  /** Reserves the strategy for this step and forwards the resolved call options. */
  private selectStrategy(strategyName: ExecutionStrategyName): ReturnType<StrategyRegistry["resolve"]> {
    const strategy = this.strategyRegistry!.resolve(strategyName);
    if (this._resolvedCallOptions && "callOptions" in strategy) {
      (strategy as { callOptions?: IModelCallOptions }).callOptions = this._resolvedCallOptions;
    }
    return strategy;
  }

  /** The real usage block of one strategy result, when one was reported. */
  private usageReportOf(validated: IChangesetResult): Opt<IComposerUsage, Reason.OptionalInput> {
    if (!validated.usage) return undefined;
    const usage = validated.usage;
    return {
      tokens: usage.prompt_tokens + usage.completion_tokens,
      cost_usd_estimate: usage.cost_usd,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      cache_creation_tokens: usage.cache_creation_tokens,
      reasoning_tokens: usage.reasoning_tokens,
      cost_source: usage.cost_source,
    };
  }

  /** Authorizes this step's reported writes against the step policy. */
  private authorizedPathsOf(options: IAgentExecutionOptions, validated: IChangesetResult): string[] {
    const declaresAllowedPaths = (options.allowed_paths?.length ?? 0) > 0;
    return declaresAllowedPaths
      ? [...(options.allowed_paths ?? []), ...this.planWrittenFiles]
      : [...this.planWrittenFiles, ...(validated.files_changed ?? [])];
  }

  /** Reverts and rejects one step that changed an unauthorized path. */
  private async rejectUnauthorizedChanges(
    portalPath: string,
    portalAlias: string,
    agentRole: string,
    context: IExecutionContext,
    unauthorizedChanges: string[],
  ): Promise<never> {
    await this.revertUnauthorizedChanges(portalPath, unauthorizedChanges);
    await this.logger.error(AGENT_EVENT_SECURITY_VIOLATION, context.trace_id, {
      portal: portalAlias,
      unauthorized_files: unauthorizedChanges,
      agent_role: agentRole,
    });
    throw new AgentExecutionError(
      `Security violation: Unauthorized file modifications detected in portal '${portalAlias}'`,
      AgentExecutionErrorType.SECURITY_VIOLATION,
    );
  }

  /** Records one executed step in the loop history. */
  private recordStepHistory(
    validated: IChangesetResult,
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    usage: Opt<IComposerUsage, Reason.OptionalInput>,
  ): void {
    const loopHistoryTokens = usage?.tokens ?? Math.max(
      1,
      this.ctx.estimateTokensSync(
        blueprint.systemPrompt + context.request + context.plan + validated.description,
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
  }

  private async prepareStepBudget(
    blueprint: IAgentFileBlueprint,
    options: IAgentExecutionOptions,
    traceId: string,
    pinnedSkills: Opt<IPinnedSkillPrompt | null, Reason.OptionalContext>,
    strategyName: ExecutionStrategyName,
  ): Promise<void> {
    const { resolution, projection } = await this.effort.resolve(blueprint, options, traceId);
    this.applyEffortResolution(resolution, projection);
    await this.ctx.allocateBudget(
      this.resolveModelId(blueprint),
      options.request_analysis as IRequestAnalysis | undefined,
      this.stepAllocationHints(options, pinnedSkills, strategyName),
    );
  }

  /** Sections the step expects to fill. An unused section is returned to the others, so pinned skills must be declared. */
  private stepAllocationHints(
    options: IAgentExecutionOptions,
    pinnedSkills: Opt<IPinnedSkillPrompt | null, Reason.OptionalContext>,
    strategyName: ExecutionStrategyName,
  ): Opt<IAllocationHints, Reason.OptionalInput> {
    const hints: IAllocationHints = {};
    // A ReAct loop carries prior actions and tool results into every later turn, in text and native mode.
    const loops = strategyName === ExecutionStrategyName.REACT ||
      (options.native_tools_enabled && this.provider && providerSupportsNativeConversation(this.provider.id));
    if (loops) {
      hints.loopHistoryUsedTokens = options.max_tool_calls * PLANNING_TOOL_CALL_OVERHEAD_TOKENS;
    }
    if (pinnedSkills && pinnedSkills.text.length > 0) {
      hints.skillsUsedTokens = Math.ceil(pinnedSkills.text.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN);
    }
    return Object.keys(hints).length > 0 ? hints : undefined;
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
    pinnedSkills?: Opt<IPinnedSkillPrompt | null, Reason.OptionalContext>,
  ): Promise<string> {
    const modelId = this.resolveModelId(blueprint);
    const tools = this._toolRegistry?.getTools();
    return this.promptBuilder.buildExecutionPrompt(blueprint, context, options, modelId, tools, pinnedSkills);
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

  /** Resolve the executeStep strategy. MCP and CLI use explicit capabilities.
   * ReAct is the default for provider-backed execution. */
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
    return ExecutionStrategyName.REACT;
  }

  /**
   * Is tool call budget exceeded?
   */
  checkToolCallLimit(toolCallCount: number, maxToolCalls: number): boolean {
    return toolCallCount > maxToolCalls;
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
  /** Log execution start to IActivity Journal */
  logExecutionStart(traceId: string, agentRole: string, portal: string): Promise<void> {
    return this.audit.logExecutionStart(traceId, agentRole, portal);
  }

  /** Log execution completion to IActivity Journal */
  logExecutionComplete(
    traceId: string,
    agentRole: string,
    result: IChangesetResult,
    usage?: Opt<IComposerUsage, Reason.OptionalInput>,
    durationMs?: Opt<number, Reason.OptionalInput>,
  ): Promise<void> {
    return this.audit.logExecutionComplete(traceId, agentRole, result, usage, durationMs);
  }

  /** Log execution error to IActivity Journal */
  logExecutionError(
    traceId: string,
    agentRole: string,
    error: { type: string; message: string; trace_id?: string; providerReasonCode?: string },
  ): Promise<void> {
    return this.audit.logExecutionError(traceId, agentRole, error);
  }

  logGeneration(
    traceId: string,
    agentRole: string,
    model: string,
    providerStr: string,
    usage: IGenerationUsage,
  ): Promise<void> {
    return logGenerationCompleted(this.logger, traceId, agentRole, model, providerStr, usage);
  }
}
