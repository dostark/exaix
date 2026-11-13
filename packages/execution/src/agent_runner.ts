/**
 * @module IAgentRunner
 * @path packages/execution/src/agent_runner.ts
 * @description Core orchestrator for agent logic.
 *
 * Features:
 * - Load blueprints and system prompts
 * - Execute LLM calls with retry logic
 * - Validate and repair structured output
 * - Handle agent feedback loops
 *
 * @architectural-layer Services
 * @related-files ["packages/request/src/processor.ts", "packages/core/src/blueprint/blueprint_loader.ts"]
 */

import type { ICallSite, IModelProvider } from "@exaix/ai/types.ts";
import type { IBlueprint } from "@exaix/core/blueprint";
import { type IGenerateResult, ModelProviderError } from "@exaix/ai/providers";
import { EffortResolver } from "@exaix/ai";
import type { IEffortResolver, TaskComplexitySource } from "@exaix/ai";

import { projectResolvedCallOptions } from "@exaix/ai";
import type { EffortDeclaration, ThinkingDeclaration } from "@exaix/schemas";

import type { IToolRegistryFactory } from "@exaix/core/types";
import type { JSONValue, OutputContract } from "@exaix/core";
import type { TaskComplexity } from "@exaix/core";

import { CallSiteCounter } from "./agent_runner_call_sites.ts";
import { AgentRunnerPlanningTools } from "./agent_runner_planning_tools.ts";
import { buildGenerateOptions, type IGenerationHints } from "./agent_runner_generation_hints.ts";
import { AgentRunnerEffort, type ISelectedModelIdentity } from "./agent_runner_effort.ts";
import { AgentRunnerAudit } from "./agent_runner_audit.ts";
import { AgentRunnerPrompts } from "./agent_runner_prompts.ts";
import { AgentRunnerSkills, type ISkillUsagePlan } from "./agent_runner_skills.ts";
import type { IGuardrailRunner } from "./guardrail_runner.ts";

import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";

import type { IApplicationContext, ISkillsContext, ISkillsService } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import type { ISkillOperationContext, ISkillPin } from "@exaix/core/skills";
import type { IExecutionMilestone } from "@exaix/schemas";
import type { IMilestoneEmitter } from "@exaix/core/observability";
import type { IContextBudgetManager } from "./context/context_budget_manager.ts";

import type { IPromptBudget, IPromptPreview } from "@exaix/schemas/prompt_budget.ts";
import type { PromptBudgetAllocator } from "@exaix/core";
import type { ITokenizer } from "@exaix/core/func";
import type { IPlanAdapter } from "@exaix/core/planning";

import { createLLMRetryPolicy, createRetryPolicy } from "@exaix/core/request";
import { createOutputValidator, type IOutputValidator, type IValidationMetrics } from "@exaix/tool-runtime";

import { renderCriticalSkillsSection, renderSkillsSection } from "@exaix/core/func";
import {
  ACTIVITY_ACTOR_AGENT,
  AGENT_EVENT_LLM_RESPONSE_RECEIVED,
  AGENT_EVENT_PROMPT_DEBUG_DUMP,
  DEFAULT_MODEL_FALLBACK,
  MILESTONE_LLM_CALL_COMPLETED,
  MILESTONE_LLM_CALL_STARTED,
  SkillRenderMode,
} from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import type { IRetryContext, IRetryPolicy, IRetryPolicyConfig, IRetryResult } from "@exaix/core/request";
import type { IRecordingLane, Opt, Reason } from "@exaix/core/types";

/** Blueprint defines the agent's persona and system instructions. Initially just a
 *  system prompt, can be extended later. */
/**
 * Context data for agent requests
 */
export interface IRequestContextContext {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | IRequestContextContext
    | (string | number | boolean | null | undefined | IRequestContextContext)[]
    | string[];
}

export interface IParsedRequest {
  /** The user's request/prompt */
  userPrompt: string;
  flowOutputKind?: "branch-json";
  /** The deliverable kind for this run. It overrides the role's declared output contract. */
  outputContract?: OutputContract;

  /** Additional context (e.g., file contents, environment info) */
  context: IRequestContextContext;

  /** Optional: Request ID for logging */
  requestId?: string;

  /** Optional: Trace ID for logging */
  traceId?: string;

  /** Optional: File paths involved in the request (for skill matching) */
  filePaths?: string[];

  /** Optional: Task type (e.g., 'feature', 'bugfix', 'refactor') */
  taskType?: string;

  /** Optional: Tags for skill matching */
  tags?: string[];

  /** Optional: Explicit skills to apply (overrides trigger matching) */
  skills?: string[];

  /** Optional: Enable dynamic routing for this request */
  allowDynamicRouting?: boolean;

  /** Optional: Model intent fields from request frontmatter */
  model?: string;
  model_size?: string;
  preferred_provider?: string;
  /** Extended-thinking declaration from request frontmatter — "auto" defers to
   *  EffortResolver. */
  thinking?: ThinkingDeclaration;
  /** Reasoning-effort declaration from request frontmatter — "auto" defers to
   *  EffortResolver. */
  effort?: EffortDeclaration;
  characteristics?: string[];

  /** Task complexity computed by RequestProcessor's TaskComplexityClassifier, stamped by
   *  processAgentRequest so EffortResolver can resolve declaration-time "auto"
   *  from the same signal the provider selector used. */
  taskComplexity?: TaskComplexity;
  /** Which signal produced `taskComplexity` — journaled with the resolution. */
  taskComplexitySource?: TaskComplexitySource;

  /** Portal alias from request frontmatter. Required for the planning tools path —
   *  absent means the tools path is skipped (`planning.tools.skipped{reason:"no_portal"}`). */
  portal?: string;

  /** Scenario id from request frontmatter, for fixture replay call-site addressing.
   *  Absent outside the scenario framework. */
  scenarioId?: string;
  /** Step id from request frontmatter, for fixture replay call-site addressing.
   *  Absent outside the scenario framework. */
  stepId?: string;
  /** Flow id the request runs under, carried into the skill operation context. Absent for non-flow calls. */
  flowId?: string;
  /** Flow-internal step id, assigned by FlowRunner from IFlowStep.id for calls it drives —
   *  scopes call-index assignment per flow step so concurrent steps in the same parallel
   *  wave cannot collide on the same index. Absent for non-flow calls. */
  flowStepId?: string;
  /** Run-local fixture lane from an opted-in flow run. It replaces the runner's shared counter. */
  recordingLane?: Opt<IRecordingLane, Reason.OptionalContext>;
  /** The flow step's own effort declaration, set by AgentComposerAdapter. Distinct from request-level `effort`. */
  flowStepEffort?: EffortDeclaration;
  /** The flow step's own thinking declaration, set by AgentComposerAdapter. */
  flowStepThinking?: ThinkingDeclaration;
  bindingEffort?: EffortDeclaration;
  bindingThinking?: ThinkingDeclaration;

  /** Portal knowledge snapshot for adaptive inclusion (`portal_knowledge.inclusion === "adaptive"`).
   *  Never persisted. `RequestProcessor.buildRequestContext` sets it and `assemblePromptSegments` consumes it.
   *  Absent in `summary` mode and outside the request pipeline. */
  portalKnowledgeSnapshot?: IPortalKnowledge;
}

/**
 * Result of agent execution containing structured response
 */
export interface IAgentExecutionResult {
  /** The agent's internal reasoning (extracted from <thought> tags) */
  thought: string;

  /** The user-facing response (extracted from <content> tags) */
  content: string;

  /** The raw, unparsed response from the LLM */
  raw: string;

  /** Skills that were matched and injected */
  skillsApplied?: string[];

  /** Durable pins for every selected skill. Absent when skills are off, empty when none were selected. */
  resolvedSkills?: ISkillPin[];
}

/**
 * Configuration for IAgentRunner
 */
export interface IAgentRunnerConfig {
  /** Canonical provider/model identity used by planning-call budgeting and pricing. */
  selectedModel?: ISelectedModelIdentity;
  /** Optional: Event logger for activity routing (preferred over db) */
  logger?: IEventLogger;

  /** Optional: Retry policy configuration */
  retryPolicy?: Partial<IRetryPolicyConfig>;

  /** Optional: Pre-configured retry policy instance */
  retryPolicyInstance?: IRetryPolicy;

  /** Optional: Disable retries entirely */
  disableRetry?: boolean;

  /** Optional: Pre-configured output validator instance */
  outputValidatorInstance?: IOutputValidator;

  /** Optional: Skills service for procedural memory */
  skillsService?: ISkillsService;

  /** Optional: Disable automatic skill matching */
  disableSkills?: boolean;

  /** Optional: Application context for service resolution */
  context?: IApplicationContext;

  /** Optional: Segment-level context budget manager. When present, called in
   *  constructPrompt() after all prompt parts are collected, before joining. */
  contextBudgetManager?: IContextBudgetManager;

  /** Optional: Real, model-aware prompt budget allocator. When present, constructPrompt()
   *  uses its output as the IPromptBudget passed to contextBudgetManager.prepare(); when
   *  absent, falls back to today's hand-built Number.MAX_SAFE_INTEGER budget. */
  promptBudgetAllocator?: PromptBudgetAllocator;

  /** Optional: Real tokenizer for segment tokenEstimate. When present, constructPrompt()
   *  calls tokenizer.countTokens() per segment; when absent, falls back to a
   *  TOKEN_ESTIMATION_CHARS_PER_TOKEN-based estimate. */
  tokenizer?: ITokenizer;

  /** Optional: Milestone emitter for semantic progress events. No-op when omitted. */
  milestoneEmitter?: IMilestoneEmitter;

  /** Optional: creates a per-run, portal-rooted IToolRegistry for the planning tools path.
   *  Same interface ExecutionLoop consumes — the daemon shares one instance between both.
   *  Absent means the tools path is always skipped (`no_registry`). */
  plannerToolRegistryFactory?: IToolRegistryFactory;

  /** Optional: screens planning tool results for blocking violations. No-op/absent in Solo. */
  guardrailRunner?: IGuardrailRunner;

  /** Optional: EffortResolver for declaration-time "auto" effort/thinking. Defaults to
   *  a fresh EffortResolver; the daemon passes its own instance. */
  effortResolver?: IEffortResolver;
}

/**
 * Interface for agent runner service
 */
export interface IAgentRunner {
  run(
    blueprint: IBlueprint,
    request: IParsedRequest,
    jsonSchema?: Opt<Record<string, JSONValue>, Reason.OptionalInput>,
  ): Promise<IAgentExecutionResult>;
}

// Agent Runner Service

/** Combines Blueprint (system prompt) with IParsedRequest (user prompt), executes via an
 *  LLM provider, and parses the structured XML response — with retry/recovery, output
 *  validation, and the Skills Architecture layered in. */
/** The normalized adapter, provider and config of one constructor call. */
function resolveRunnerInputs(
  planAdapterOrProvider?: Opt<IPlanAdapter | IModelProvider, Reason.OptionalDependency>,
  modelProviderOrConfig?: Opt<IModelProvider | IAgentRunnerConfig, Reason.OptionalDependency>,
  config?: Opt<IAgentRunnerConfig, Reason.OptionalDependency>,
): { planAdapter: IPlanAdapter; provider: IModelProvider; config: Opt<IAgentRunnerConfig, Reason.OptionalDependency> } {
  const isOldStyle = planAdapterOrProvider != null && "generate" in planAdapterOrProvider;
  const planAdapter = isOldStyle
    ? createNoopPlanAdapter()
    : (planAdapterOrProvider as IPlanAdapter | undefined) ?? createNoopPlanAdapter();
  const resolvedConfig = isOldStyle ? (modelProviderOrConfig as IAgentRunnerConfig | undefined) : config;
  const provider = isOldStyle
    ? (planAdapterOrProvider as IModelProvider)
    : (modelProviderOrConfig as IModelProvider | undefined) || resolvedConfig?.context?.provider;
  if (!provider) throw new Error("IAgentRunner requires a model provider");
  return { planAdapter, provider, config: resolvedConfig };
}

/** True when skill matching is on and a skills service is present. */
function skillsEnabledOf(
  disableSkills: boolean,
  skillsService: Opt<ISkillsService, Reason.OptionalDependency>,
): boolean {
  return !disableSkills && !!skillsService;
}

/** The retry policy the runner config selects, or the LLM default. */
function retryPolicyOf(
  config: Opt<IAgentRunnerConfig, Reason.OptionalDependency>,
  providerErrorsAreFinal: { isPermanent: (error: Error) => boolean },
) {
  return config?.retryPolicyInstance ||
    (config?.retryPolicy
      ? createRetryPolicy(config.retryPolicy, providerErrorsAreFinal)
      : createLLMRetryPolicy(providerErrorsAreFinal));
}

/** The role of one run and the ids that correlate its journal rows. */
interface IRunIdentity {
  readonly agentRole: string;
  readonly requestId: Opt<string, Reason.TraceAbsent>;
  readonly traceId: Opt<string, Reason.TraceAbsent>;
}

/** The assembled prompt and the call options that one attempt runs with. */
interface IRunAttemptInput {
  readonly combinedPrompt: string;
  readonly startTime: number;
  readonly hints: IGenerationHints;
  readonly promptBudget: IPromptBudget;
  readonly skillUsage: ISkillUsagePlan | null;
  readonly callSite: ICallSite | undefined;
}

export class AgentRunner implements IAgentRunner {
  private logger?: IEventLogger;
  private retryPolicy: IRetryPolicy;
  private disableRetry: boolean;
  private outputValidator: IOutputValidator;
  private skillsService?: ISkillsService;
  private disableSkills: boolean;
  private readonly skills: AgentRunnerSkills;
  private readonly prompts: AgentRunnerPrompts;
  private readonly audit: AgentRunnerAudit;
  private readonly effort: AgentRunnerEffort;
  private readonly planningTools: AgentRunnerPlanningTools;
  /** Shared with the siblings that `withProvider` returns, so one counter addresses every call. */
  private callSites = new CallSiteCounter();
  private planAdapter: IPlanAdapter;

  private modelProvider: IModelProvider;
  private config?: IAgentRunnerConfig;
  private effortResolver: IEffortResolver;
  /** Return an invocation-local runner with the same dependencies and a bound model. */
  withProvider(provider: IModelProvider, selectedModel: ISelectedModelIdentity): AgentRunner {
    const sibling = new AgentRunner(this.planAdapter, provider, { ...this.config, selectedModel });
    sibling.callSites = this.callSites;
    return sibling;
  }

  constructor(
    planAdapterOrProvider?: Opt<IPlanAdapter | IModelProvider, Reason.OptionalDependency>,
    modelProviderOrConfig?: Opt<IModelProvider | IAgentRunnerConfig, Reason.OptionalDependency>,
    config?: Opt<IAgentRunnerConfig, Reason.OptionalDependency>,
  ) {
    const inputs = resolveRunnerInputs(planAdapterOrProvider, modelProviderOrConfig, config);
    this.planAdapter = inputs.planAdapter;
    this.config = inputs.config;
    const ctx = inputs.config?.context;
    this.modelProvider = inputs.provider;
    this.logger = inputs.config?.logger;
    this.disableRetry = inputs.config?.disableRetry ?? false;
    this.effortResolver = inputs.config?.effortResolver ?? new EffortResolver();
    this.skillsService = ctx?.skills || inputs.config?.skillsService;
    this.disableSkills = inputs.config?.disableSkills ?? false;
    this.skills = new AgentRunnerSkills({
      skillsService: this.skillsService,
      disableSkills: this.disableSkills,
      contextBudgetChars: () => this.config?.context?.config.get().skills?.context_budget_chars,
      journal: { record: (action, target, payload) => this.logActivity(ACTIVITY_ACTOR_AGENT, action, target, payload) },
    });
    this.planningTools = new AgentRunnerPlanningTools({
      config: this.config,
      modelProvider: this.modelProvider,
      logger: this.logger,
      skills: this.skills,
      callSites: {
        resolve: (request) => this.callSites.resolve(request),
        consume: (site) => this.callSites.consume(site),
      },
      modelId: () => this.prompts.modelId(),
      runGeneration: (fn, startTime) => this.runGeneration(fn, startTime),
      journal: (action, target, payload, traceId, agentRole) =>
        this.logActivity(ACTIVITY_ACTOR_AGENT, action, target, payload, traceId, agentRole),
    });
    this.effort = new AgentRunnerEffort({
      effortResolver: this.effortResolver,
      modelProvider: this.modelProvider,
      config: this.config,
      selectedModel: () => this.selectedModelIdentity(),
      journal: (action, target, payload, traceId, agentRole) =>
        this.logActivity(ACTIVITY_ACTOR_AGENT, action, target, payload, traceId, agentRole),
    });
    this.audit = new AgentRunnerAudit({
      logger: this.logger,
      retryEnabled: !this.disableRetry,
      skillsEnabled: skillsEnabledOf(this.disableSkills, this.skillsService),
      journal: (action, target, payload, traceId, agentRole) =>
        this.logActivity(ACTIVITY_ACTOR_AGENT, action, target, payload, traceId, agentRole),
    });
    this.prompts = new AgentRunnerPrompts({
      planAdapter: this.planAdapter,
      config: this.config,
      skills: this.skills,
      selectedModel: () => this.selectedModelIdentity(),
      planningEngaged: (request, agentRole) => this.planningTools.resolvePlanningGate(request, agentRole).engage,
      journal: (action, target, payload, traceId) =>
        this.logActivity(ACTIVITY_ACTOR_AGENT, action, target, payload, traceId),
    });
    // The provider layer owns HTTP retries, so a classified provider error is final here.
    const providerErrorsAreFinal = { isPermanent: (error: Error) => error instanceof ModelProviderError };
    this.retryPolicy = retryPolicyOf(inputs.config, providerErrorsAreFinal);
    this.outputValidator = inputs.config?.outputValidatorInstance || createOutputValidator({ autoRepair: true });
    this.retryPolicy.setOnRetry?.((ctx: IRetryContext) => this.audit.logRetryAttempt(ctx));
  }

  private async emitMilestone(
    milestoneType: IExecutionMilestone["milestoneType"],
    traceId: Opt<string, Reason.TraceAbsent>,
    summary: string,
  ): Promise<void> {
    const emitter = this.config?.milestoneEmitter;
    if (!emitter) return;
    await emitter.emit({
      milestoneId: crypto.randomUUID(),
      traceId: traceId ?? "",
      milestoneType,
      requiresAttention: false,
      occurredAt: new Date().toISOString(),
      summary,
    });
  }

  /** Runs the agent with a blueprint (system prompt) and the parsed user request,
   *  returning a structured execution result with thought and content. */
  async run(
    blueprint: IBlueprint,
    request: IParsedRequest,
    jsonSchema: Opt<Record<string, JSONValue>, Reason.OptionalInput>,
  ): Promise<IAgentExecutionResult> {
    const startTime = Date.now();
    const agentRole = blueprint.agentRole || "unknown";
    const traceId = request.traceId;
    const requestId = request.requestId;

    const skillOperation = this.skills.buildSkillOperation(request, agentRole);
    const { skillIds, skillsContext } = await this.skills.matchAndApplySkills(
      blueprint,
      request,
      agentRole,
      skillOperation,
    );
    this.audit.logExecutionStart(request, agentRole, traceId, requestId, skillIds);

    const identity: IRunIdentity = { agentRole, requestId, traceId };
    const prompt = await this.assembleRunPrompt(blueprint, request, identity, skillIds, skillsContext, skillOperation);
    const { callSite, hints } = await this.resolveRunHints(
      blueprint,
      request,
      agentRole,
      skillsContext,
      traceId,
      requestId,
      jsonSchema,
    );
    const { retryResult } = await this.executeRunAttempt(request, identity, {
      combinedPrompt: prompt.combinedPrompt,
      startTime,
      hints,
      promptBudget: prompt.promptBudget,
      skillUsage: prompt.skillUsage,
      callSite,
    });

    const generateResult = retryResult.value;
    await this.emitMilestone(
      MILESTONE_LLM_CALL_COMPLETED,
      traceId,
      `LLM call completed for ${agentRole}`,
    );
    const rawResponse = generateResult?.content || "";
    this.logActivityDebug(AGENT_EVENT_LLM_RESPONSE_RECEIVED, requestId || null, {
      agent_role: agentRole,
      response_length: rawResponse.length,
      full_response: rawResponse,
      stop_reason: generateResult?.stop_reason ?? null,
      prompt_tokens: generateResult?.usage?.promptTokens ?? null,
      completion_tokens: generateResult?.usage?.completionTokens ?? null,
    }, traceId);
    this.audit.warnOnStopReason(generateResult, rawResponse, agentRole, requestId, traceId);
    const result = this.parseResponse(rawResponse);
    this.audit.logExecutionCompletion({
      result,
      rawResponse,
      retryResult,
      requestId,
      agentRole,
      traceId,
      duration: Date.now() - startTime,
      skillsApplied: skillIds,
    });
    return {
      ...result,
      skillsApplied: skillIds.length > 0 ? skillIds : undefined,
      resolvedSkills: prompt.resolvedSkills,
    };
  }

  /** Renders the skill context and assembles the run prompt and its skill usage plan. */
  private async assembleRunPrompt(
    blueprint: IBlueprint,
    request: IParsedRequest,
    identity: IRunIdentity,
    skillIds: string[],
    skillsContext: ISkillsContext | null,
    skillOperation: ISkillOperationContext,
  ): Promise<{
    combinedPrompt: string;
    promptBudget: IPromptBudget;
    skillUsage: ISkillUsagePlan | null;
    resolvedSkills: ISkillPin[] | undefined;
  }> {
    const { agentRole, requestId, traceId } = identity;
    const trimmedSkillRender = this.config?.context?.config.get().skills?.render_mode === SkillRenderMode.TRIMMED;
    const skillContextString = renderSkillsSection(skillsContext, trimmedSkillRender);
    const criticalSkillContext = renderCriticalSkillsSection(skillsContext);
    const { prompt: combinedPrompt, budget: promptBudget } = await this.prompts.constructPrompt(
      blueprint,
      request,
      skillContextString,
      criticalSkillContext,
    );
    const skillUsage = this.skills.buildSkillUsagePlan(
      skillsContext,
      combinedPrompt,
      trimmedSkillRender,
      skillOperation,
    );
    const resolvedSkills = await this.skills.persistSkillPins(
      skillsContext,
      skillUsage,
      trimmedSkillRender,
      skillOperation,
    );
    this.logActivity(
      ACTIVITY_ACTOR_AGENT,
      DomainEventType.AgentPromptAssembled,
      requestId || null,
      {
        prompt_kind: "planning",
        agent_role: agentRole,
        prompt_length: combinedPrompt.length,
        skillIdsUsed: skillIds,
        skillsCount: skillIds.length,
        retrievalLatencyMs: skillsContext?.retrievalLatencyMs || 0,
      },
      traceId,
      agentRole,
    );
    this.logActivityDebug(AGENT_EVENT_PROMPT_DEBUG_DUMP, requestId || null, {
      agent_role: agentRole,
      prompt_length: combinedPrompt.length,
      system_prompt_length: blueprint.systemPrompt.length,
      skill_context_length: skillContextString.length,
      critical_skill_context_length: criticalSkillContext.length,
      full_prompt: combinedPrompt,
    }, traceId);
    return { combinedPrompt, promptBudget, skillUsage, resolvedSkills };
  }

  /** Resolves the call site and the generation hints of one run. */
  private async resolveRunHints(
    blueprint: IBlueprint,
    request: IParsedRequest,
    agentRole: string,
    skillsContext: ISkillsContext | null,
    traceId: Opt<string, Reason.TraceAbsent>,
    requestId: Opt<string, Reason.TraceAbsent>,
    jsonSchema: Opt<Record<string, JSONValue>, Reason.OptionalInput>,
  ): Promise<{ callSite: ICallSite | undefined; hints: IGenerationHints }> {
    const callSite = this.callSites.resolve(request);
    const skillFloors = this.skills.skillFloorsOf(skillsContext);
    const resolution = await this.effort.resolve(blueprint, request, agentRole, skillFloors);
    const projection = projectResolvedCallOptions(
      resolution,
      this.effort.declarationsOf(blueprint, request),
      this.modelProvider.callCapabilities,
    );
    this.effort.journalResolution(blueprint, request, agentRole, resolution, { traceId, requestId }, projection);
    await this.emitMilestone(MILESTONE_LLM_CALL_STARTED, traceId, `LLM call started for ${agentRole}`);
    return {
      callSite,
      hints: {
        conversationId: traceId,
        jsonSchema,
        callSite,
        thinking: projection.thinking,
        effort: projection.effort,
      },
    };
  }

  /** Runs the planning tools or the provider call, then records the attempt's side effects. */
  private async executeRunAttempt(
    request: IParsedRequest,
    identity: IRunIdentity,
    attempt: IRunAttemptInput,
  ): Promise<{
    retryResult: Awaited<ReturnType<AgentRunner["executeWithRetry"]>>;
    toolsResult: IRetryResult<IGenerateResult> | undefined;
  }> {
    const { agentRole, requestId, traceId } = identity;
    const { combinedPrompt, startTime, hints, promptBudget, skillUsage, callSite } = attempt;
    const toolsResult = await this.planningTools.runPlanningToolsIfGated(
      request,
      agentRole,
      combinedPrompt,
      startTime,
      hints,
      { promptBudget, usage: skillUsage },
    );
    const retryResult = toolsResult ?? await this.executeWithRetry(combinedPrompt, startTime, hints, skillUsage);
    if (skillUsage?.auditError) throw skillUsage.auditError;
    if (!retryResult.success) {
      this.audit.handleExecutionFailure(retryResult, requestId, agentRole, traceId, Date.now() - startTime);
    }
    if (!toolsResult) this.callSites.consume(callSite);
    return { retryResult, toolsResult };
  }

  /**
   * Execute the model generation with retry logic
   */
  private async executeWithRetry(
    combinedPrompt: string,
    startTime: number,
    hints: IGenerationHints,
    usage: ISkillUsagePlan | null,
  ): Promise<IRetryResult<IGenerateResult>> {
    const generateOptions = buildGenerateOptions(hints);
    return await this.runGeneration(
      this.skills.withSkillUsage(usage, () => this.modelProvider.generate(combinedPrompt, generateOptions)),
      startTime,
    );
  }

  /** Shared retry-wrapping used by both executeWithRetry and the planning tools loop's
   *  per-round `generate` callback, so retry behavior never diverges between the two. */
  private async runGeneration(
    fn: () => Promise<IGenerateResult>,
    startTime: number,
  ): Promise<IRetryResult<IGenerateResult>> {
    if (this.disableRetry) {
      try {
        const rawResponse = await fn();
        return {
          success: true,
          value: rawResponse,
          totalAttempts: 1,
          totalTimeMs: Date.now() - startTime,
          retryHistory: [],
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          totalAttempts: 1,
          totalTimeMs: Date.now() - startTime,
          retryHistory: [],
        };
      }
    }
    return await this.retryPolicy.execute(fn);
  }

  /** Non-mutating preview of the prompt assembly, never a real LLM call. */
  async previewPrompt(blueprint: IBlueprint, request: IParsedRequest): Promise<IPromptPreview> {
    return await this.prompts.previewPrompt(blueprint, request);
  }

  private selectedModelIdentity(): ISelectedModelIdentity {
    return this.config?.selectedModel ?? {
      provider: DEFAULT_MODEL_FALLBACK,
      model: DEFAULT_MODEL_FALLBACK,
    };
  }

  /** Parses the LLM response to extract <thought> and <content> tags via OutputValidator;
   *  falls back to treating the whole response as content if tags are missing. */
  private parseResponse(rawResponse: string): IAgentExecutionResult {
    const parsed = this.outputValidator.parseXMLTags(rawResponse);

    return {
      thought: parsed.thought,
      content: parsed.content,
      raw: parsed.raw,
    };
  }

  /** Gets validation metrics from the output validator. */
  getValidationMetrics(): IValidationMetrics {
    return this.outputValidator.getMetrics();
  }

  /**
   * Log activity to IActivity Journal (if database provided)
   */

  private logActivity(
    _actor: string,
    actionType: string,
    target: string | null,
    payload: Record<string, JSONValue>,
    traceId?: Opt<string, Reason.TraceAbsent>,
    agentRole?: Opt<string | null, Reason.OptionalContext>,
  ): void {
    if (!this.logger) return;
    void this.logger.log({
      action: actionType,
      target: target ?? "",
      payload,
      traceId,
      agentRole: agentRole ?? undefined,
    });
  }

  /** Debug-level activity log (filtered out unless the logger's minLevel is DEBUG). Used
   *  for diagnostic dumps too verbose for INFO but useful when investigating unexpected
   *  provider output. */
  private logActivityDebug(
    actionType: string,
    target: string | null,
    payload: Record<string, JSONValue>,
    traceId: Opt<string, Reason.TraceAbsent>,
  ): void {
    if (!this.logger) return;
    void this.logger.debug(actionType, target, payload, traceId);
  }
}

function createNoopPlanAdapter(): IPlanAdapter {
  return {
    getSchemaInstructions: () => "",
  };
}
