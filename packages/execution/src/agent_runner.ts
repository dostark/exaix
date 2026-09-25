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

import type { ICallSite, IModelOptions, IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { COMPLEXITY_SOURCE_DEFAULT, EffortResolver, ProviderRegistry, resolveProviderType } from "@exaix/ai";
import type { IEffortResolution, IEffortResolutionSignals, IEffortResolver, TaskComplexitySource } from "@exaix/ai";
import type { EffortDeclaration, EffortTier, ModelSize, ThinkingDeclaration } from "@exaix/schemas";
import { toSafeJson } from "@exaix/core/types";
import type { IToolRegistryFactory } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";
import { PlanningToolLoopStopReason, PlanningToolsSkipReason, PortalOperation, TaskComplexity } from "@exaix/core";
import type { ProviderType } from "@exaix/core";
import { PortalPermissionsService } from "@exaix/portal";
import { readOnlyEditorTools } from "@exaix/tool-runtime";
import type { IPortalPermissions } from "@exaix/schemas/portal_permissions.ts";
import { PlanningToolLoop } from "./planning_tool_loop.ts";
import type { IGuardrailRunner } from "./guardrail_runner.ts";
import { providerSupportsNativeTools } from "./native_tool_turns.ts";
import type { ISkill, ISkillMatch } from "@exaix/schemas/memory_bank.ts";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import type { IPortalKnowledgeSelectionAppliedPayload } from "@exaix/core/events";
import { buildAdaptivePortalKnowledge } from "@exaix/core/func";
import type { IPortalKnowledgeRequestSignals } from "@exaix/core/func";
import type { IApplicationContext, ISkillsContext, ISkillsService } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import type { IExecutionMilestone } from "@exaix/schemas";
import type { IMilestoneEmitter } from "@exaix/core/observability";
import type { IContextBudgetManager } from "./context/context_budget_manager.ts";
import type { IContextSegment } from "./context/context_segment.ts";
import { ContextSegmentKindSchema } from "@exaix/schemas/execution/context_budget.ts";
import type { IPromptBudget, IPromptPreview, IPromptPreviewSegment } from "@exaix/schemas/prompt_budget.ts";
import type { PromptBudgetAllocator } from "@exaix/core";
import type { ITokenizer } from "@exaix/core/func";
import type { IPlanAdapter } from "@exaix/core/planning";
import {
  DEFAULT_PORTAL_KNOWLEDGE_CORE_MAX_TOKENS,
  DEFAULT_PORTAL_KNOWLEDGE_MAX_TOKENS,
  DEFAULT_PORTAL_KNOWLEDGE_RELEVANT_MAX_ENTRIES,
  PortalKnowledgeInclusion,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
} from "@exaix/core";
import { computeRegistryPredictedCost } from "./registry_computed_cost.ts";
import { createLLMRetryPolicy, createRetryPolicy } from "@exaix/core/request";
import { createOutputValidator, type IOutputValidator, type IValidationMetrics } from "@exaix/tool-runtime";
import { extractKeywords } from "@exaix/core/func";
import { renderCriticalSkillsSection, renderSkillsSection } from "@exaix/core/func";
import {
  ACTIVITY_ACTOR_AGENT,
  AGENT_EVENT_EXECUTION_COMPLETED,
  AGENT_EVENT_EXECUTION_STARTED,
  AGENT_EVENT_LLM_RESPONSE_RECEIVED,
  AGENT_EVENT_PROMPT_DEBUG_DUMP,
  AGENT_EVENT_RESPONSE_TRUNCATED,
  DEFAULT_MODEL_FALLBACK,
  DEFAULT_UNKNOWN_ERROR_MESSAGE,
  DEFAULT_UNKNOWN_LABEL,
  MEMORY_CONTEXT_KEY,
  MILESTONE_LLM_CALL_COMPLETED,
  MILESTONE_LLM_CALL_STARTED,
  PLANNING_TOOL_CALL_OVERHEAD_TOKENS,
  PORTAL_CONTEXT_KEY,
  PORTAL_KNOWLEDGE_KEY,
  RESPONSE_STOP_REASON_MAX_TOKENS,
  SKILL_EVENT_RESOLVED,
  SKILL_EVENT_RETRIEVAL_FAILED,
  SKILL_EVENT_RETRIEVAL_TIMEOUT,
  SkillRenderMode,
} from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import type { IRetryContext, IRetryPolicy, IRetryPolicyConfig, IRetryResult } from "@exaix/core/request";
import type { Opt, Reason } from "@exaix/core/types";
import { tokenBoundedPrefix } from "./context/token_bounded_prefix.ts";

export interface ISelectedModelIdentity {
  provider: string;
  model: string;
  /** Canonical provider type — set from IProviderInfo.type at the construction sites;
   *  AgentRunner falls back to resolveProviderType(provider) when absent. */
  providerType?: ProviderType;
}

type SegmentEntry = { content: string; kind: IContextSegment["kind"]; priority: number; nonCompactable: boolean };

/** Blueprint defines the agent's persona and system instructions. Initially just a
 *  system prompt, can be extended later. */
export interface IBlueprint {
  systemPrompt: string;

  /** Optional: Agent identifier for logging */
  agentRole?: string;

  /** Optional: Default skills to apply for all requests */
  defaultSkills?: string[];

  /** Optional: Extended-thinking declaration, sourced from frontmatter.thinking.
   *  "auto" defers to EffortResolver; a boolean is final. */
  thinking?: ThinkingDeclaration;

  /** Optional: Reasoning-effort declaration, sourced from frontmatter.effort.
   *  "auto" defers to EffortResolver; a concrete tier is final. */
  effort?: EffortDeclaration;

  /** Optional: Model size tier (S/M/L/XL), sourced from frontmatter.model_size — caps
   *  heuristic effort resolution for small models. */
  modelSize?: ModelSize;
}

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

/**
 * IParsedRequest represents the user's intent and any additional context
 */
export interface IParsedRequest {
  /** The user's request/prompt */
  userPrompt: string;

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
  /** Flow-internal step id, assigned by FlowRunner from IFlowStep.id for calls it drives —
   *  scopes call-index assignment per flow step so concurrent steps in the same parallel
   *  wave cannot collide on the same index. Absent for non-flow calls. */
  flowStepId?: string;
  /** Flow step's own effort declaration, set by AgentComposerAdapter for declared flow
   *  steps (GAP-4) — distinct from request-level `effort`. */
  flowStepEffort?: EffortDeclaration;
  /** Flow step's own thinking declaration, set by AgentComposerAdapter for declared flow
   *  steps (GAP-4). */
  flowStepThinking?: ThinkingDeclaration;

  /** Resolved portal knowledge snapshot for adaptive inclusion (`portal_knowledge.inclusion
   *  === "adaptive"`). Ephemeral — never persisted to the request file or `knowledge.json`;
   *  set once by `RequestProcessor.buildRequestContext` and consumed by
   *  `assemblePromptSegments`. Absent in `summary` mode and outside the request pipeline. */
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

/** Bundles executeWithRetry's per-call generation hints into one param, keeping it under
 *  the 7-parameter style limit. Effort/thinking here are always RESOLVED values from
 *  EffortResolver — the declaration-time surface ("auto") never enters this object. */
interface IGenerationHints {
  conversationId: Opt<string, Reason.TraceAbsent>;
  jsonSchema: Opt<Record<string, JSONValue>, Reason.OptionalInput>;
  callSite: Opt<ICallSite, Reason.OptionalContext>;
  thinking: Opt<boolean, Reason.OptionalContext>;
  effort: Opt<EffortTier, Reason.OptionalContext>;
}

/** Comma-separated skill ids to exclude from the resolved set for this process's lifetime.
 *  A skill-ablation arm's control side sets this instead of adding a request-contract
 *  field; safe because the scenario framework runs one scenario per daemon process. */
export const EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR = "EXA_EVAL_SUPPRESS_SKILLS";

function readSuppressedSkillIds(): Set<string> {
  const raw = Deno.env.get(EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR) ?? "";
  return new Set(raw.split(",").map((id) => id.trim()).filter((id) => id.length > 0));
}

// Agent Runner Service

/** Combines Blueprint (system prompt) with IParsedRequest (user prompt), executes via an
 *  LLM provider, and parses the structured XML response — with retry/recovery, output
 *  validation, and the Skills Architecture layered in. */
export class AgentRunner implements IAgentRunner {
  private logger?: IEventLogger;
  private retryPolicy: IRetryPolicy;
  private disableRetry: boolean;
  private outputValidator: IOutputValidator;
  private skillsService?: ISkillsService;
  private disableSkills: boolean;
  private planAdapter: IPlanAdapter;

  private modelProvider: IModelProvider;
  private config?: IAgentRunnerConfig;
  private effortResolver: IEffortResolver;
  /** Next call index per (scenarioId, stepId), for fixture replay addressing.
   *  Incremented once per consumed response — a retried logical call keeps its index. */
  private callIndexByCallSite = new Map<string, number>();

  constructor(
    planAdapterOrProvider?: Opt<IPlanAdapter | IModelProvider, Reason.OptionalDependency>,
    modelProviderOrConfig?: Opt<IModelProvider | IAgentRunnerConfig, Reason.OptionalDependency>,
    config?: Opt<IAgentRunnerConfig, Reason.OptionalDependency>,
  ) {
    const isOldStyle = planAdapterOrProvider != null && "generate" in planAdapterOrProvider;
    this.planAdapter = isOldStyle
      ? createNoopPlanAdapter()
      : (planAdapterOrProvider as IPlanAdapter | undefined) ?? createNoopPlanAdapter();
    this.config = isOldStyle ? (modelProviderOrConfig as IAgentRunnerConfig | undefined) : config;
    const ctx = this.config?.context;
    const provider = isOldStyle
      ? (planAdapterOrProvider as IModelProvider)
      : (modelProviderOrConfig as IModelProvider | undefined) || ctx?.provider;
    if (!provider) {
      throw new Error("IAgentRunner requires a model provider");
    }
    this.modelProvider = provider;
    this.logger = this.config?.logger;
    this.disableRetry = this.config?.disableRetry ?? false;
    this.effortResolver = this.config?.effortResolver ?? new EffortResolver();
    this.skillsService = ctx?.skills || this.config?.skillsService;
    this.disableSkills = this.config?.disableSkills ?? false;
    this.retryPolicy = this.config?.retryPolicyInstance ||
      (this.config?.retryPolicy ? createRetryPolicy(this.config.retryPolicy) : createLLMRetryPolicy());
    this.outputValidator = this.config?.outputValidatorInstance || createOutputValidator({ autoRepair: true });

    // Set up retry logging
    this.retryPolicy.setOnRetry?.((ctx: IRetryContext) => {
      this.logActivity(
        ACTIVITY_ACTOR_AGENT,
        "agent.retry_attempt",
        null,
        {
          attempt: ctx.attempt,
          delay_ms: ctx.delayMs,
          temperature: ctx.temperature,
          elapsed_ms: ctx.elapsedMs,
          error_type: ctx.error.constructor.name,
          error_message: ctx.error.message,
        },
      );
    });
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

    // Match skills based on request context
    const { skillIds, skillsContext } = await this.matchAndApplySkills(blueprint, request, agentRole);

    // Log agent execution start
    this.logExecutionStart(request, agentRole, traceId, requestId, skillIds);

    // Construct the combined prompt (with skill context). Critical skills render into a
    // separate, protected segment so the output contract and hard constraints survive
    // context-budget pressure.
    const trimmedSkillRender = this.config?.context?.config.get().skills?.render_mode === SkillRenderMode.TRIMMED;
    const skillContextString = renderSkillsSection(skillsContext, trimmedSkillRender);
    const criticalSkillContext = renderCriticalSkillsSection(skillsContext);
    const combinedPrompt = await this.constructPrompt(
      blueprint,
      request,
      skillContextString,
      criticalSkillContext,
    );

    // Log prompt assembled event for observability
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

    // Debug-level dump of the actual assembled prompt text — lets a dry-run diagnosis
    // (no LLM call needed) confirm the prompt is complete and not truncated, independent
    // of whatever the model returns. Left in for future debugging, not just this one.
    this.logActivityDebug(AGENT_EVENT_PROMPT_DEBUG_DUMP, requestId || null, {
      agent_role: agentRole,
      prompt_length: combinedPrompt.length,
      system_prompt_length: blueprint.systemPrompt.length,
      skill_context_length: skillContextString.length,
      critical_skill_context_length: criticalSkillContext.length,
      full_prompt: combinedPrompt,
    }, traceId);

    // Execute via the model provider (with retry if enabled)
    const callSite = this.resolveCallSite(request);
    const skillFloors = skillsContext?.matched?.map((m) => ({
      skillId: m.skillId,
      effort: m.effort,
      thinking: m.thinking,
    })) ?? [];
    const resolution = this.resolveEffortAndThinking(blueprint, request, agentRole, skillFloors);
    await this.emitMilestone(MILESTONE_LLM_CALL_STARTED, traceId, `LLM call started for ${agentRole}`);
    const hints: IGenerationHints = {
      conversationId: traceId,
      jsonSchema,
      callSite,
      thinking: resolution.thinking,
      effort: resolution.effort,
    };
    const toolsResult = await this.runPlanningToolsIfGated(request, agentRole, combinedPrompt, startTime, hints);
    const retryResult = toolsResult ?? await this.executeWithRetry(combinedPrompt, startTime, hints);

    const duration = Date.now() - startTime;

    // Handle retry failure
    if (!retryResult.success) {
      this.handleExecutionFailure(retryResult, requestId, agentRole, traceId, duration);
    }
    if (!toolsResult) this.markCallSiteConsumed(callSite);

    // Parse the response to extract thought and content
    const generateResult = retryResult.value;
    await this.emitMilestone(MILESTONE_LLM_CALL_COMPLETED, traceId, `LLM call completed for ${agentRole}`);
    const rawResponse = generateResult?.content || "";
    this.logActivityDebug(AGENT_EVENT_LLM_RESPONSE_RECEIVED, requestId || null, {
      agent_role: agentRole,
      response_length: rawResponse.length,
      full_response: rawResponse,
      stop_reason: generateResult?.stop_reason ?? null,
      prompt_tokens: generateResult?.usage?.promptTokens ?? null,
      completion_tokens: generateResult?.usage?.completionTokens ?? null,
    }, traceId);
    // A max_tokens stop means the answer was cut off mid-generation: downstream structured
    // parsing is expected to fail on it, and that failure must be attributable to
    // truncation, not treated as a mysteriously malformed model response.
    if (generateResult?.stop_reason === RESPONSE_STOP_REASON_MAX_TOKENS && this.logger) {
      void this.logger.warn(AGENT_EVENT_RESPONSE_TRUNCATED, requestId || null, {
        agent_role: agentRole,
        stop_reason: generateResult.stop_reason,
        response_length: rawResponse.length,
        completion_tokens: generateResult?.usage?.completionTokens ?? null,
      }, traceId);
    }
    const result = this.parseResponse(rawResponse);

    // Log successful execution
    this.logExecutionCompletion({
      result,
      rawResponse,
      retryResult,
      requestId,
      agentRole,
      traceId,
      duration,
      skillsApplied: skillIds,
    });

    return {
      ...result,
      skillsApplied: skillIds.length > 0 ? skillIds : undefined,
    };
  }

  /** Resolves declaration-time effort/thinking through EffortResolver, keyed on the
   *  selected model's provider identity and the request's TaskComplexity signal. */
  private resolveEffortAndThinking(
    blueprint: IBlueprint,
    request: IParsedRequest,
    agentRole: string,
    skillFloors: ReadonlyArray<{ skillId: string; effort?: EffortTier; thinking?: boolean }>,
  ): IEffortResolution {
    const selectedModel = this.selectedModelIdentity();
    const providerType = selectedModel.providerType ?? resolveProviderType(selectedModel.provider);
    const providerMetadata = providerType !== undefined
      ? ProviderRegistry.getProviderMetadata(providerType)
      : undefined;
    const signals: IEffortResolutionSignals = {
      taskComplexity: request.taskComplexity ?? TaskComplexity.MEDIUM,
      complexitySource: request.taskComplexitySource ?? COMPLEXITY_SOURCE_DEFAULT,
      modelSize: blueprint.modelSize,
      providerType,
      model: selectedModel.model,
      providerSupportsThinking: providerMetadata?.supportsThinking === true,
      anthropicThinkingDefault: this.config?.context?.config.get().ai_anthropic?.thinking_default,
      skillFloors,
      agentRole,
    };
    return this.effortResolver.resolve(
      {
        role: { effort: blueprint.effort, thinking: blueprint.thinking },
        request: { effort: request.effort, thinking: request.thinking },
        flowStep: { effort: request.flowStepEffort, thinking: request.flowStepThinking },
      },
      signals,
    );
  }

  /**
   * Match and apply skills for the given request
   */
  private async matchAndApplySkills(
    blueprint: IBlueprint,
    request: IParsedRequest,
    agentRole: string,
  ): Promise<{ skillIds: string[]; skillsContext: ISkillsContext | null }> {
    if (!this.skillsService || this.disableSkills) {
      return { skillIds: [], skillsContext: null };
    }

    const matchingStartTime = Date.now();
    try {
      // ONE rule: the resulting set is pinned ∪ dynamically-matched ∪ agent-role defaults —
      // no branch-specific merge rules, so it's always predictable why a skill was or
      // wasn't injected. Prompt bloat is controlled by keeping default_skills short.
      const matchScores = new Map<string, number>();
      const skillIds: string[] = [];
      const add = (id: string, score: number) => {
        if (skillIds.includes(id)) return;
        skillIds.push(id);
        matchScores.set(id, score);
      };

      const pinned = request.skills ?? [];
      for (const id of pinned) add(id, 1.0);

      // Dynamic matching is skipped when the request pinned skills explicitly — the pin is
      // the caller stating what they want, and matching would only add noise to it.
      const matched: string[] = [];
      if (!pinned.length) {
        try {
          const result = await this.performDynamicSkillMatching(request, agentRole);
          for (const match of result.matches) {
            matched.push(match.skillId);
            add(match.skillId, match.confidence);
          }
        } catch (error: unknown) {
          this.logSkillRetrievalFailure(error instanceof Error ? error.message : String(error), agentRole);
        }
      }

      const defaults = blueprint.defaultSkills ?? [];
      for (const id of defaults) add(id, 0.5);

      // A skill-ablation arm's control side suppresses a skill from the FINAL resolved
      // set — after pinned/matched/defaults are unioned, not only from the dynamic-match
      // sub-path — so a pin- or default-only skill is suppressed just as reliably.
      const suppressed = readSuppressedSkillIds();
      const suppressedPresent = skillIds.filter((id) => suppressed.has(id));
      for (const id of suppressedPresent) {
        skillIds.splice(skillIds.indexOf(id), 1);
        matchScores.delete(id);
      }

      this.logSkillResolution(agentRole, skillIds, pinned, matched, defaults, suppressedPresent);

      const totalAvailable = skillIds.length;

      // 5. Hydration
      const skillsContext = await this.hydrateSkills(
        skillIds,
        matchScores,
        totalAvailable,
        matchingStartTime,
      );

      // 6. Persistence
      for (const skillId of skillIds) {
        await this.skillsService.recordSkillUsage(skillId).catch(() => {});
      }

      return { skillIds, skillsContext };
    } catch (error) {
      console.error("[IAgentRunner] Skill management critical failure:", error);
      return { skillIds: [], skillsContext: null };
    }
  }

  /** Performs dynamic skill matching with a 500ms timeout guard. */
  private async performDynamicSkillMatching(
    request: IParsedRequest,
    agentRole: string,
  ): Promise<{ matches: ISkillMatch[]; totalAvailable: number }> {
    const skillsConfig = this.config?.context?.config.get().skills;

    const matchingPromise = this.skillsService!.matchSkills({
      requestText: request.userPrompt,
      keywords: this.extractKeywords(request.userPrompt),
      taskType: request.taskType,
      filePaths: request.filePaths,
      tags: request.tags,
      agentRole,
      contextBudgetChars: skillsConfig?.context_budget_chars,
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<{ matches: ISkillMatch[]; totalAvailable: number }>((_, reject) =>
      timeoutId = setTimeout(() => reject(new Error("Skill matching timed out")), 500)
    );

    try {
      return await Promise.race([matchingPromise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Hydrate skill IDs into full ISkillsContext for prompt injection
   */
  private async hydrateSkills(
    skillIds: string[],
    matchScores: Map<string, number>,
    totalAvailable: number,
    startTime: number,
  ): Promise<ISkillsContext | null> {
    if (skillIds.length === 0) return null;

    const skillsFound = await Promise.all(
      skillIds.map((id) => this.skillsService!.getSkill(id)),
    );

    const validSkills = skillsFound.filter((s): s is ISkill => s !== null);

    return {
      matched: validSkills.map((s) => ({
        skillId: s.id,
        title: s.name,
        description: s.description,
        content: s.instructions,
        matchScore: matchScores.get(s.id) ?? 0.5,
        tags: s.triggers.tags || [],
        critical: s.critical ?? false,
        effort: s.effort,
        thinking: s.thinking,
        examples: s.examples,
      })),
      totalAvailable,
      retrievalLatencyMs: Date.now() - startTime,
    };
  }

  /**
   * Log the start of agent execution
   */
  private logExecutionStart(
    request: IParsedRequest,
    agentRole: string,
    traceId: Opt<string, Reason.TraceAbsent>,
    requestId: Opt<string, Reason.TraceAbsent>,
    skillsApplied: string[],
  ): void {
    this.logActivity(
      ACTIVITY_ACTOR_AGENT,
      AGENT_EVENT_EXECUTION_STARTED,
      requestId || null,
      {
        agent_role: agentRole,
        prompt_length: request.userPrompt.length,
        has_context: Object.keys(request.context).length > 0,
        retry_enabled: !this.disableRetry,
        skills_enabled: !this.disableSkills && !!this.skillsService,
        skills_matched: skillsApplied.length,
        skills_applied: skillsApplied,
      },
      traceId,
      agentRole,
    );
  }

  /** Assigns the call site for this logical call, reading (not yet incrementing) the next
   *  call index for (scenarioId, stepId, flowStepId); flowStepId scopes the counter so
   *  concurrent flow steps in the same parallel wave cannot collide on one callIndex. */
  private resolveCallSite(request: IParsedRequest): ICallSite | undefined {
    if (!request.scenarioId || !request.stepId) return undefined;
    const key = this.callSiteCounterKey(request.scenarioId, request.stepId, request.flowStepId);
    const callIndex = this.callIndexByCallSite.get(key) ?? 0;
    return {
      scenarioId: request.scenarioId,
      stepId: request.stepId,
      // Omitted entirely (not set to undefined) for non-flow calls, so a plain ReAct-loop
      // callSite's shape is byte-identical to before this field existed.
      ...(request.flowStepId ? { flowStepId: request.flowStepId } : {}),
      callIndex,
    };
  }

  /** Advances the call index for a call site once its response has actually been
   *  consumed. Retries within the SAME logical call reuse the callSite object assigned
   *  before the retry loop started, so only a subsequent run() sees the new index. */
  private markCallSiteConsumed(callSite: Opt<ICallSite, Reason.OptionalContext>): void {
    if (!callSite) return;
    const key = this.callSiteCounterKey(callSite.scenarioId, callSite.stepId, callSite.flowStepId);
    this.callIndexByCallSite.set(key, callSite.callIndex + 1);
  }

  /** Shared key builder for the callIndex counter map — resolveCallSite and
   *  markCallSiteConsumed must compute an identical key or the counter never advances. */
  private callSiteCounterKey(
    scenarioId: string,
    stepId: string,
    flowStepId: Opt<string, Reason.OptionalContext>,
  ): string {
    return `${scenarioId}::${stepId}::${flowStepId ?? ""}`;
  }

  /** Builds the IModelOptions overlay executeWithRetry passes to the provider from a set of
   *  generation hints — extracted so the planning-tools path (PlanningToolLoop's baseOptions)
   *  builds the identical conversationId/jsonSchema/thinking/effort shape. */
  private buildGenerateOptions(hints: IGenerationHints): IModelOptions | undefined {
    const { conversationId, jsonSchema, callSite, thinking, effort } = hints;
    return conversationId || jsonSchema || callSite || thinking !== undefined || effort
      ? {
        ...(conversationId ? { conversationId } : {}),
        ...(conversationId ? { traceId: conversationId } : {}),
        ...(thinking !== undefined ? { thinking } : {}),
        ...(effort ? { effort } : {}),
        ...(jsonSchema ? { jsonSchema } : {}),
        ...(callSite ? { callSite } : {}),
      }
      : undefined;
  }

  /**
   * Execute the model generation with retry logic
   */
  private async executeWithRetry(
    combinedPrompt: string,
    startTime: number,
    hints: IGenerationHints,
  ): Promise<IRetryResult<IGenerateResult>> {
    const generateOptions = this.buildGenerateOptions(hints);
    return await this.runGeneration(() => this.modelProvider.generate(combinedPrompt, generateOptions), startTime);
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

  /** Bundles a planning-gate decision: either the request engages the tools path with a
   *  resolved portal, or it doesn't (optionally with a reason worth journaling). */
  private resolvePlanningGate(
    request: IParsedRequest,
    agentRole: string,
  ): { engage: true; portal: IPortalPermissions } | { engage: false; reason?: PlanningToolsSkipReason } {
    const planning = this.config?.context?.config.get().planning;
    if (!planning?.tools_enabled || planning.max_tool_rounds <= 1) return { engage: false };

    const providerId = this.config?.selectedModel?.provider ?? this.modelProvider.id;
    if (!providerSupportsNativeTools(providerId)) {
      return { engage: false, reason: PlanningToolsSkipReason.PROVIDER_UNSUPPORTED };
    }

    if (!request.portal) return { engage: false, reason: PlanningToolsSkipReason.NO_PORTAL };
    const portals = this.config?.context?.config.get().portals ?? [];
    const portal = portals.find((p) => p.alias === request.portal);
    if (!portal) return { engage: false, reason: PlanningToolsSkipReason.NO_PORTAL };

    if (!this.config?.plannerToolRegistryFactory || !this.config?.tokenizer) {
      return { engage: false, reason: PlanningToolsSkipReason.NO_REGISTRY };
    }

    const permission = new PortalPermissionsService([portal]).checkOperationAllowed(
      portal.alias,
      agentRole,
      PortalOperation.READ,
    );
    if (!permission.allowed) return { engage: false, reason: PlanningToolsSkipReason.PORTAL_READ_DENIED };

    return { engage: true, portal };
  }

  /** Drives PlanningToolLoop when gated, returning an IRetryResult-shaped success (or
   *  undefined, falling back to executeWithRetry); journals `planning.tools.skipped` when
   *  a gate denied a flag-on request. */
  private async runPlanningToolsIfGated(
    request: IParsedRequest,
    agentRole: string,
    combinedPrompt: string,
    startTime: number,
    hints: IGenerationHints,
  ): Promise<IRetryResult<IGenerateResult> | undefined> {
    const gate = this.resolvePlanningGate(request, agentRole);
    const traceId = hints.conversationId;
    if (!gate.engage) {
      if (gate.reason) {
        this.logActivity(
          ACTIVITY_ACTOR_AGENT,
          DomainEventType.PlanningToolsSkipped,
          request.requestId ?? null,
          { reason: gate.reason },
          traceId,
          agentRole,
        );
      }
      return undefined;
    }

    const planning = this.config!.context!.config.get().planning!;
    const registry = this.config!.plannerToolRegistryFactory!.createToolRegistry(
      traceId ?? "",
      gate.portal.target_path,
    );
    const allowedTools = new Set(readOnlyEditorTools().map((t) => t.name));
    const baseOptions = this.buildGenerateOptions({ ...hints, callSite: undefined }) ?? {};

    const loop = new PlanningToolLoop({
      toolRegistry: registry,
      tokenizer: this.config!.tokenizer!,
      modelId: this.selectedModelId(),
      generate: (prompt, options) =>
        this.runGeneration(() => this.modelProvider.generate(prompt, options), startTime).then((r) => {
          if (!r.success) throw r.error ?? new Error("Planning tool round failed");
          return r.value!;
        }),
      logger: this.logger,
      guardrailRunner: this.config!.guardrailRunner,
    });

    let lastCallSite: Opt<ICallSite, Reason.TraceAbsent> = undefined;
    const result = await loop.run({
      prompt: combinedPrompt,
      baseOptions,
      nextCallSite: () => {
        if (lastCallSite) this.markCallSiteConsumed(lastCallSite);
        lastCallSite = this.resolveCallSite(request);
        return lastCallSite;
      },
      portalAlias: gate.portal.alias,
      portalRoot: gate.portal.target_path,
      allowedTools,
      maxRounds: planning.max_tool_rounds,
      maxToolResultTokens: planning.max_tool_result_tokens,
      maxToolCallsPerRound: planning.max_tool_calls_per_round,
      traceId: traceId ?? "",
    });
    this.markCallSiteConsumed(lastCallSite);

    // A provider that ignored toolChoice none left no plan text; retrying the whole loop would
    // repeat the failure, so hand back to the single-call path.
    if (result.stopReason === PlanningToolLoopStopReason.EMPTY_FINAL) return undefined;

    return {
      success: true,
      value: result.final,
      totalAttempts: result.rounds,
      totalTimeMs: Date.now() - startTime,
      retryHistory: [],
    };
  }

  /**
   * Handle execution failure by logging and throwing
   */
  private handleExecutionFailure(
    retryResult: IRetryResult<IGenerateResult>,
    requestId: Opt<string, Reason.TraceAbsent>,
    agentRole: string,
    traceId: Opt<string, Reason.TraceAbsent>,
    duration: number,
  ): never {
    this.logActivity(
      ACTIVITY_ACTOR_AGENT,
      "agent.execution_failed",
      requestId || null,
      {
        agent_role: agentRole,
        duration_ms: duration,
        total_attempts: retryResult.totalAttempts,
        retry_history: toSafeJson(retryResult.retryHistory),
        error_type: retryResult.error?.constructor.name || DEFAULT_UNKNOWN_LABEL,
        error_message: retryResult.error?.message || DEFAULT_UNKNOWN_ERROR_MESSAGE,
      },
      traceId,
      agentRole,
    );

    throw retryResult.error || new Error("Agent execution failed after retries");
  }

  /**
   * Log successful execution completion
   */
  private logExecutionCompletion(args: {
    result: { thought: string; content: string };
    rawResponse: string;
    retryResult: IRetryResult<IGenerateResult>;
    requestId: string | undefined;
    agentRole: string;
    traceId: string | undefined;
    duration: number;
    skillsApplied: string[];
  }): void {
    const {
      result,
      rawResponse,
      retryResult,
      requestId,
      agentRole,
      traceId,
      duration,
      skillsApplied,
    } = args;
    this.logActivity(
      ACTIVITY_ACTOR_AGENT,
      AGENT_EVENT_EXECUTION_COMPLETED,
      requestId || null,
      {
        agent_role: agentRole,
        duration_ms: duration,
        total_attempts: retryResult.totalAttempts,
        retry_history: retryResult.retryHistory.length > 0 ? toSafeJson(retryResult.retryHistory) : null,
        response_length: rawResponse?.length || 0,
        has_thought: result.thought.length > 0,
        has_content: result.content.length > 0,
        skills_applied: skillsApplied.length > 0 ? toSafeJson(skillsApplied) : null,
      },
      traceId,
      agentRole,
    );
  }

  /** Constructs the combined prompt from blueprint, request, and optional skill context. */
  /** Builds every prompt segment through the budget pipeline; the one shared place
   *  `constructPrompt` and `previewPrompt` both assemble from, so they can't diverge. */
  private defaultPromptBudget(modelId: string): IPromptBudget {
    return {
      model: modelId,
      totalBudgetTokens: Number.MAX_SAFE_INTEGER,
      safetyBufferTokens: 0,
      sections: {
        system: Number.MAX_SAFE_INTEGER,
        plan: Number.MAX_SAFE_INTEGER,
        portalKnowledge: Number.MAX_SAFE_INTEGER,
        memory: Number.MAX_SAFE_INTEGER,
        skills: Number.MAX_SAFE_INTEGER,
        loopHistory: Number.MAX_SAFE_INTEGER,
      },
    };
  }

  /** Builds every segment except adaptive mode's knowledge entry, which the caller sizes
   *  separately (needs a preliminary budget pass) and appends itself. */
  private async buildBaseEntries(
    blueprint: IBlueprint,
    request: IParsedRequest,
    inclusionMode: string,
    skillContext?: Opt<string, Reason.OptionalContext>,
    criticalSkillContext?: Opt<string, Reason.OptionalContext>,
  ): Promise<{ entries: SegmentEntry[]; directoryListingEntryIndex: number }> {
    const k = ContextSegmentKindSchema.enum;
    const entries: SegmentEntry[] = [];

    if (blueprint.systemPrompt.trim()) {
      entries.push({ content: blueprint.systemPrompt, kind: k.system, priority: 100, nonCompactable: true });
    }
    // Critical skills (W16) — protected, non-droppable segment (same tier as the
    // schema/acceptance-criteria instructions) so the contract + hard constraints
    // survive budget pressure. Ordinary skills stay droppable below.
    if (criticalSkillContext?.trim()) {
      entries.push({ content: criticalSkillContext, kind: k.acceptance_criteria, priority: 90, nonCompactable: true });
    }
    if (skillContext?.trim()) {
      entries.push({ content: skillContext, kind: k.skills, priority: 50, nonCompactable: false });
    }
    const schemaInstructions = this.planAdapter.getSchemaInstructions();
    entries.push({ content: schemaInstructions, kind: k.acceptance_criteria, priority: 90, nonCompactable: true });

    let directoryListingEntryIndex = -1;
    const portalContext = request.context?.[PORTAL_CONTEXT_KEY];
    if (typeof portalContext === "string" && portalContext.trim()) {
      directoryListingEntryIndex = entries.length;
      entries.push({ content: portalContext, kind: k.portal_knowledge, priority: 60, nonCompactable: false });
    }

    if (inclusionMode !== PortalKnowledgeInclusion.ADAPTIVE || !request.portalKnowledgeSnapshot) {
      const portalKnowledge = request.context?.[PORTAL_KNOWLEDGE_KEY];
      if (typeof portalKnowledge === "string" && portalKnowledge.trim()) {
        entries.push({
          content: await this.capPortalKnowledge(portalKnowledge),
          kind: k.portal_knowledge,
          priority: 60,
          nonCompactable: false,
        });
      }
    }
    const memoryContext = request.context?.[MEMORY_CONTEXT_KEY];
    if (typeof memoryContext === "string" && memoryContext.trim()) {
      entries.push({ content: memoryContext, kind: k.reflection, priority: 40, nonCompactable: false });
    }
    if (request.userPrompt.trim()) {
      // Skills render under their own "### HEADING" markers; a markdown heading here would
      // be outranked by a request body's own "#"/"##" headings, so use an hr-delimited
      // block instead so the task boundary stays unambiguous either way.
      const labeledRequest = `---\nYOUR TASK — this is the actual task to complete now:\n---\n\n${request.userPrompt}`;
      entries.push({ content: labeledRequest, kind: k.request, priority: 75, nonCompactable: true });
    }

    return { entries, directoryListingEntryIndex };
  }

  private async assemblePromptSegments(
    blueprint: IBlueprint,
    request: IParsedRequest,
    skillContext?: Opt<string, Reason.OptionalContext>,
    criticalSkillContext?: Opt<string, Reason.OptionalContext>,
    opts?: Opt<{ journal?: boolean }, Reason.OptionalContext>,
  ): Promise<{ allSegments: IContextSegment[]; includedSegments: IContextSegment[]; budget: IPromptBudget }> {
    const k = ContextSegmentKindSchema.enum;
    const portalKnowledgeConfig = this.config?.context?.config.get().portal_knowledge;
    const inclusionMode = portalKnowledgeConfig?.inclusion ?? "summary";
    const { entries, directoryListingEntryIndex } = await this.buildBaseEntries(
      blueprint,
      request,
      inclusionMode,
      skillContext,
      criticalSkillContext,
    );

    const tokenizer = this.config?.tokenizer;
    const modelId = this.selectedModelId();
    const toSegments = async (list: SegmentEntry[]): Promise<IContextSegment[]> =>
      await Promise.all(
        list.map(async (e, i) => ({
          segmentId: `prompt-part-${i}`,
          content: e.content,
          kind: e.kind,
          priority: e.priority,
          tokenEstimate: await tokenizer?.countTokens(e.content, modelId) ??
            Math.ceil(e.content.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN),
          metadata: { nonCompactable: e.nonCompactable },
        })),
      );

    let adaptiveEntryIndex = -1;
    let adaptivePayload: IPortalKnowledgeSelectionAppliedPayload | undefined;
    if (inclusionMode === PortalKnowledgeInclusion.ADAPTIVE && request.portalKnowledgeSnapshot && tokenizer) {
      const adaptive = await this.buildAdaptiveKnowledgeEntry({
        request,
        entries,
        directoryListingEntryIndex,
        portalKnowledgeConfig,
        tokenizer,
        modelId,
        toSegments,
      });
      if (adaptive) {
        adaptiveEntryIndex = entries.length;
        entries.push({ content: adaptive.content, kind: k.portal_knowledge, priority: 60, nonCompactable: false });
        adaptivePayload = adaptive.payload;
      }
    }

    const allSegments = await toSegments(entries);
    const allocationHints = this.buildAllocationHints(allSegments);
    const planningGate = this.resolvePlanningGate(request, blueprint.agentRole || "unknown");
    if (planningGate.engage) {
      const planning = this.config!.context!.config.get().planning!;
      allocationHints.loopHistoryUsedTokens += (planning.max_tool_rounds - 1) * planning.max_tool_calls_per_round *
        (planning.max_tool_result_tokens + PLANNING_TOOL_CALL_OVERHEAD_TOKENS);
    }
    const budget: IPromptBudget = await this.config?.promptBudgetAllocator?.allocate(modelId, allocationHints) ??
      this.defaultPromptBudget(modelId);

    const manager = this.config?.contextBudgetManager;
    const includedSegments = manager
      ? (await manager.prepare({
        traceId: request.traceId ?? "unknown",
        stepId: "agent-runner",
        model: modelId,
        promptBudget: budget,
        segments: allSegments,
      })).segments
      : allSegments;

    if (adaptivePayload) {
      const includedById = new Map(includedSegments.map((segment) => [segment.segmentId, segment]));
      adaptivePayload.includedTokens = includedById.get(`prompt-part-${adaptiveEntryIndex}`)?.tokenEstimate ?? 0;
      if (opts?.journal !== false) {
        this.logActivity(
          ACTIVITY_ACTOR_AGENT,
          DomainEventType.PortalKnowledgeSelectionApplied,
          request.requestId ?? null,
          { ...adaptivePayload },
          request.traceId,
        );
      }
    }

    return { allSegments, includedSegments, budget };
  }

  /** Sizes and renders adaptive mode's knowledge entry: a preliminary allocation (without
   *  this entry) yields the shared `portalKnowledge` section budget, then
   *  `buildAdaptivePortalKnowledge` fills whatever remains after the directory listing. */
  private async buildAdaptiveKnowledgeEntry(args: {
    request: IParsedRequest;
    entries: SegmentEntry[];
    directoryListingEntryIndex: number;
    portalKnowledgeConfig: { max_tokens?: number; core_max_tokens?: number; relevant_max_entries?: number } | undefined;
    tokenizer: ITokenizer;
    modelId: string;
    toSegments: (list: SegmentEntry[]) => Promise<IContextSegment[]>;
  }): Promise<{ content: string; payload: IPortalKnowledgeSelectionAppliedPayload } | undefined> {
    const { request, entries, directoryListingEntryIndex, portalKnowledgeConfig, tokenizer, modelId, toSegments } =
      args;
    const preliminarySegments = await toSegments(entries);
    const preliminaryHints = this.buildAllocationHints(preliminarySegments);
    const preliminaryBudget = await this.config?.promptBudgetAllocator?.allocate(modelId, preliminaryHints) ??
      this.defaultPromptBudget(modelId);
    const directoryListingTokens = directoryListingEntryIndex >= 0
      ? preliminarySegments[directoryListingEntryIndex].tokenEstimate
      : 0;
    const maxTokens = portalKnowledgeConfig?.max_tokens ?? DEFAULT_PORTAL_KNOWLEDGE_MAX_TOKENS;
    const coreMaxTokens = portalKnowledgeConfig?.core_max_tokens ?? DEFAULT_PORTAL_KNOWLEDGE_CORE_MAX_TOKENS;
    const relevantMaxEntries = portalKnowledgeConfig?.relevant_max_entries ??
      DEFAULT_PORTAL_KNOWLEDGE_RELEVANT_MAX_ENTRIES;
    const availableTokens = Math.max(
      0,
      Math.min(maxTokens, preliminaryBudget.sections.portalKnowledge - directoryListingTokens),
    );
    if (availableTokens === 0) return undefined;

    const signals: IPortalKnowledgeRequestSignals = {
      userPrompt: request.userPrompt,
      filePaths: request.filePaths,
      taskType: request.taskType,
      tags: request.tags,
    };
    // Non-null: caller only invokes this when request.portalKnowledgeSnapshot is set.
    const result = await buildAdaptivePortalKnowledge(request.portalKnowledgeSnapshot!, signals, {
      tokenizer,
      modelId,
      availableTokens,
      coreMaxTokens,
      relevantMaxEntries,
    });
    if (!result.content.trim()) return undefined;

    return {
      content: result.content,
      payload: {
        inclusion: PortalKnowledgeInclusion.ADAPTIVE,
        availableTokens,
        coreTokens: await tokenizer.countTokens(result.core, modelId),
        selectedEntryIds: result.relevant.map((entry) => entry.id),
        selectedTokens: result.budgetUsedTokens,
        includedTokens: result.budgetUsedTokens,
      },
    };
  }

  private async constructPrompt(
    blueprint: IBlueprint,
    request: IParsedRequest,
    skillContext?: Opt<string, Reason.OptionalContext>,
    criticalSkillContext?: Opt<string, Reason.OptionalContext>,
  ): Promise<string> {
    const { includedSegments } = await this.assemblePromptSegments(
      blueprint,
      request,
      skillContext,
      criticalSkillContext,
    );
    return includedSegments.map((s) => s.content).join("\n\n");
  }

  /** Hard token cap on `portal_knowledge` at assembly (a direct-set block bypasses
   *  `ContextBudgetManager` under an infinite/unset budget); keeps whole lines and uses the
   *  real tokenizer to guarantee the kept prefix's estimate fits the cap. */
  private async capPortalKnowledge(content: string): Promise<string> {
    const maxTokens = this.config?.context?.config.get().portal_knowledge?.max_tokens ??
      DEFAULT_PORTAL_KNOWLEDGE_MAX_TOKENS;
    const tokenizer = this.config?.tokenizer;
    const estimate = async (text: string): Promise<number> =>
      await tokenizer?.countTokens(text, this.selectedModelId()) ??
        Math.ceil(text.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN);

    if (await estimate(content) <= maxTokens) return content;

    const lines = content.split("\n");
    const kept: string[] = [];
    for (const line of lines) {
      const candidate = kept.length === 0 ? line : `${kept.join("\n")}\n${line}`;
      const candidateTokens = await estimate(candidate);
      if (candidateTokens > maxTokens) break;
      kept.push(line);
    }
    if (kept.length === 0) {
      return await tokenBoundedPrefix(content, maxTokens, estimate);
    }
    return kept.join("\n");
  }

  /** Non-mutating preview of `constructPrompt`'s assembly — a per-segment breakdown, not
   *  a joined string, and never a real LLM call. Runs its own skill matching (like `run()`). */
  async previewPrompt(blueprint: IBlueprint, request: IParsedRequest): Promise<IPromptPreview> {
    const agentRole = blueprint.agentRole || "unknown";
    const { skillIds, skillsContext } = await this.matchAndApplySkills(blueprint, request, agentRole);
    const trimmedSkillRender = this.config?.context?.config.get().skills?.render_mode === SkillRenderMode.TRIMMED;
    const skillContextString = renderSkillsSection(skillsContext, trimmedSkillRender);
    const criticalSkillContext = renderCriticalSkillsSection(skillsContext);

    const { allSegments, includedSegments, budget } = await this.assemblePromptSegments(
      blueprint,
      request,
      skillContextString,
      criticalSkillContext,
      { journal: false },
    );

    const includedById = new Map(includedSegments.map((segment) => [segment.segmentId, segment]));
    const encoder = new TextEncoder();
    const segments: IPromptPreviewSegment[] = allSegments.map((segment) => {
      const resulting = includedById.get(segment.segmentId);
      const resultingTokens = resulting?.tokenEstimate ?? 0;
      const resultingBytes = resulting ? encoder.encode(resulting.content).length : 0;
      return {
        segmentId: segment.segmentId,
        kind: segment.kind,
        priority: segment.priority,
        originalTokenEstimate: segment.tokenEstimate,
        resultingTokenEstimate: resultingTokens,
        tokenEstimate: resultingTokens,
        originalByteLength: encoder.encode(segment.content).length,
        resultingByteLength: resultingBytes,
        byteLength: resultingBytes,
        nonCompactable: segment.metadata.nonCompactable ?? false,
        included: resulting !== undefined,
      };
    });

    // A dropped segment is absent from includedContentById; a trimmed segment (same
    // section's only occupant, still present but shortened) has different content — both
    // count as real compaction, unlike a bare segment-count comparison would catch.
    const compactionTriggered = allSegments.some((segment) =>
      includedById.get(segment.segmentId)?.content !== segment.content
    );

    const selectedModel = this.selectedModelIdentity();
    const totalTokenEstimate = segments.reduce((sum, segment) => sum + segment.resultingTokenEstimate, 0);
    const estimatedCostUsd = computeRegistryPredictedCost(selectedModel.provider, selectedModel.model, {
      promptTokens: totalTokenEstimate,
      completionTokens: 0,
    });

    return {
      segments,
      totalTokenEstimate,
      budgetTotalTokens: budget.totalBudgetTokens,
      compactionTriggered,
      matchedSkillIds: skillIds,
      ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
    };
  }

  private selectedModelIdentity(): ISelectedModelIdentity {
    return this.config?.selectedModel ?? {
      provider: DEFAULT_MODEL_FALLBACK,
      model: DEFAULT_MODEL_FALLBACK,
    };
  }

  private selectedModelId(): string {
    const selected = this.selectedModelIdentity();
    return `${selected.provider}:${selected.model}`;
  }

  private buildAllocationHints(segments: IContextSegment[]): Record<
    | "systemUsedTokens"
    | "planUsedTokens"
    | "portalKnowledgeUsedTokens"
    | "memoryUsedTokens"
    | "skillsUsedTokens"
    | "loopHistoryUsedTokens",
    number
  > {
    const hints = {
      systemUsedTokens: 0,
      planUsedTokens: 0,
      portalKnowledgeUsedTokens: 0,
      memoryUsedTokens: 0,
      skillsUsedTokens: 0,
      loopHistoryUsedTokens: 0,
    };
    for (const segment of segments) {
      switch (segment.kind) {
        case ContextSegmentKindSchema.enum.system:
          hints.systemUsedTokens += segment.tokenEstimate;
          break;
        case ContextSegmentKindSchema.enum.portal_knowledge:
          hints.portalKnowledgeUsedTokens += segment.tokenEstimate;
          break;
        case ContextSegmentKindSchema.enum.reflection:
          hints.memoryUsedTokens += segment.tokenEstimate;
          break;
        case ContextSegmentKindSchema.enum.skills:
          hints.skillsUsedTokens += segment.tokenEstimate;
          break;
        case ContextSegmentKindSchema.enum.tool_result:
        case ContextSegmentKindSchema.enum.summary:
          hints.loopHistoryUsedTokens += segment.tokenEstimate;
          break;
        default:
          hints.planUsedTokens += segment.tokenEstimate;
      }
    }
    return hints;
  }

  /** Extracts keywords from text for skill matching. */
  private extractKeywords(text: string): string[] {
    return extractKeywords(text);
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

  /** Resets validation metrics. */
  resetValidationMetrics(): void {
    this.outputValidator.resetMetrics();
  }

  /**
   * Log activity to IActivity Journal (if database provided)
   */

  /** Journals a dynamic skill-match that timed out or threw — this path silently
   *  degrades the agent (proceeds with NO skills at all), so the Activity Journal must
   *  record it. The 500ms timeout is distinguished from a genuine failure. */
  private logSkillRetrievalFailure(message: string, agentRole: string): void {
    this.logActivity(
      ACTIVITY_ACTOR_AGENT,
      message.includes("timed out") ? SKILL_EVENT_RETRIEVAL_TIMEOUT : SKILL_EVENT_RETRIEVAL_FAILED,
      agentRole,
      { agent_role: agentRole, error: message },
    );
    console.warn("[IAgentRunner] Skill matching failed or timed out, continuing without skills:", message);
  }

  /** Journals the final skill set together with the three inputs that produced it.
   *  `skills.match_completed` alone is skipped entirely for a pinned request, so this
   *  breakdown is what makes the union auditable without re-deriving the merge. */
  private logSkillResolution(
    agentRole: string,
    skillIds: string[],
    pinned: string[],
    matched: string[],
    defaults: string[],
    suppressed: string[],
  ): void {
    this.logActivity(ACTIVITY_ACTOR_AGENT, SKILL_EVENT_RESOLVED, agentRole, {
      agent_role: agentRole,
      skill_ids: skillIds,
      skill_count: skillIds.length,
      pinned_skill_ids: pinned,
      matched_skill_ids: matched,
      default_skill_ids: defaults,
      suppressed_skill_ids: suppressed,
    });
  }

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

export function createAgentRunner(
  planAdapter?: Opt<IPlanAdapter, Reason.OptionalDependency>,
  modelProvider?: Opt<IModelProvider, Reason.OptionalDependency>,
  agentConfig?: Opt<IAgentRunnerConfig, Reason.OptionalDependency>,
): IAgentRunner {
  return new AgentRunner(planAdapter, modelProvider, agentConfig);
}
