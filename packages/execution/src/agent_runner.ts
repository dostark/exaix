/**
 * @module AgentRunner
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

import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { toSafeJson } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";
import type { ISkill, ISkillMatch } from "@exaix/schemas/memory_bank.ts";
import type { IApplicationContext, ISkillsContext, ISkillsService } from "@exaix/core/types";
import type { IDatabaseService } from "@exaix/core/types";
import type { IContextBudgetManager } from "./context/context_budget_manager.ts";
import type { IContextSegment } from "./context/context_segment.ts";
import { ContextSegmentKindSchema } from "@exaix/schemas/execution/context_budget.ts";
import type { IPromptBudget } from "@exaix/schemas/prompt_budget.ts";
import { createLLMRetryPolicy, createRetryPolicy } from "@exaix/core/request";
import { createOutputValidator, type IOutputValidator, type IValidationMetrics } from "@exaix/tool-runtime";
import { extractKeywords } from "@exaix/core/func";
import { renderSkillsSection } from "@exaix/core/func";
import {
  ACTIVITY_ACTOR_AGENT,
  AGENT_EVENT_EXECUTION_COMPLETED,
  AGENT_EVENT_EXECUTION_STARTED,
  AGENT_EVENT_PROMPT_ASSEMBLED,
  DEFAULT_UNKNOWN_ERROR_MESSAGE,
  DEFAULT_UNKNOWN_LABEL,
  MEMORY_CONTEXT_KEY,
  PORTAL_CONTEXT_KEY,
  PORTAL_KNOWLEDGE_KEY,
} from "@exaix/core";
import type { IRetryContext, IRetryPolicy, IRetryPolicyConfig, IRetryResult } from "@exaix/core/request";

/**
 * Blueprint defines the agent's persona and system instructions
 * Initially just a system prompt, can be extended later
 */
export interface IBlueprint {
  systemPrompt: string;

  /** Optional: Agent identifier for logging */
  identityId?: string;

  /** Optional: Default skills to apply for all requests (Phase 17) */
  defaultSkills?: string[];
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

  /** Optional: Explicit skills to apply (overrides trigger matching) - Phase 17 */
  skills?: string[];

  /** Optional: Skills to skip/disable for this request - Phase 17 */
  skipSkills?: string[];

  /** Optional: Enable dynamic routing for this request */
  allowDynamicRouting?: boolean;
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

  /** Skills that were matched and injected (Phase 17) */
  skillsApplied?: string[];
}

/**
 * Configuration for AgentRunner
 */
export interface IAgentRunnerConfig {
  /** Optional: Database service for activity logging */
  db?: IDatabaseService;

  /** Optional: Retry policy configuration */
  retryPolicy?: Partial<IRetryPolicyConfig>;

  /** Optional: Pre-configured retry policy instance */
  retryPolicyInstance?: IRetryPolicy;

  /** Optional: Disable retries entirely */
  disableRetry?: boolean;

  /** Optional: Pre-configured output validator instance */
  outputValidatorInstance?: IOutputValidator;

  /** Optional: Skills service for procedural memory (Phase 17) */
  skillsService?: ISkillsService;

  /** Optional: Disable automatic skill matching */
  disableSkills?: boolean;

  /** Optional: Application context for service resolution */
  context?: IApplicationContext;

  /** Optional: Segment-level context budget manager (Phase 83). When present, called in
   * constructPrompt() after all prompt parts are collected, before joining. */
  contextBudgetManager?: IContextBudgetManager;
}

/**
 * Interface for agent runner service
 */
export interface IAgentRunner {
  run(
    blueprint: IBlueprint,
    request: IParsedRequest,
  ): Promise<IAgentExecutionResult>;
}

export interface IPlanAdapter {
  parseAndValidate(blueprint: IBlueprint, request: IParsedRequest): Promise<IAgentExecutionResult>;
  formatForModel?(blueprint: IBlueprint, request: IParsedRequest): string;
  getSchemaInstructions(): string;
}

// ============================================================================
// Agent Runner Service
// ============================================================================

/**
 * AgentRunner combines Blueprint (system prompt) with IParsedRequest (user prompt),
 * executes via an LLM provider, and parses the structured XML response.
 *
 * Enhanced with retry/recovery (Phase 16.3):
 * - Exponential backoff on transient failures
 * - Temperature adjustment on retries
 * - Detailed retry logging
 *
 * Enhanced with output validation (Phase 16.2):
 * - XML tag extraction (<thought>, <content>)
 * - JSON repair for malformed outputs
 * - Validation metrics tracking
 *
 * Enhanced with Skills Architecture (Phase 17):
 * - Automatic skill matching based on request context
 * - Skill context injection into prompts
 * - Skill usage tracking
 */
export class AgentRunner implements IAgentRunner {
  private db?: IDatabaseService;
  private retryPolicy: IRetryPolicy;
  private disableRetry: boolean;
  private outputValidator: IOutputValidator;
  private skillsService?: ISkillsService;
  private disableSkills: boolean;
  private planAdapter: IPlanAdapter;

  private modelProvider: IModelProvider;
  private config?: IAgentRunnerConfig;

  constructor(
    planAdapterOrProvider?: IPlanAdapter | IModelProvider,
    modelProviderOrConfig?: IModelProvider | IAgentRunnerConfig,
    config?: IAgentRunnerConfig,
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
      throw new Error("AgentRunner requires a model provider");
    }
    this.modelProvider = provider;
    this.db = ctx?.db || this.config?.db;
    this.disableRetry = this.config?.disableRetry ?? false;
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

  /**
   * Run the agent with a blueprint and request
   * @param blueprint - The agent's blueprint (system prompt)
   * @param request - The parsed user request
   * @returns Structured execution result with thought and content
   */
  async run(
    blueprint: IBlueprint,
    request: IParsedRequest,
  ): Promise<IAgentExecutionResult> {
    const startTime = Date.now();
    const identityId = blueprint.identityId || "unknown";
    const traceId = request.traceId;
    const requestId = request.requestId;

    // Phase 17/70: Match skills based on request context
    const { skillIds, skillsContext } = await this.matchAndApplySkills(blueprint, request, identityId);

    // Log agent execution start
    this.logExecutionStart(request, identityId, traceId, requestId, skillIds);

    // Step 1: Construct the combined prompt (with skill context) (Phase 70)
    const skillContextString = renderSkillsSection(skillsContext);
    const combinedPrompt = await this.constructPrompt(blueprint, request, skillContextString);

    // Phase 70: Log prompt assembled event for observability
    this.logActivity(
      ACTIVITY_ACTOR_AGENT,
      AGENT_EVENT_PROMPT_ASSEMBLED,
      requestId || null,
      {
        identity_id: identityId,
        prompt_length: combinedPrompt.length,
        skillIdsUsed: skillIds,
        skillsCount: skillIds.length,
        retrievalLatencyMs: skillsContext?.retrievalLatencyMs || 0,
      },
      traceId,
      identityId,
    );

    // Step 2: Execute via the model provider (with retry if enabled)
    const retryResult = await this.executeWithRetry(combinedPrompt, startTime);

    const duration = Date.now() - startTime;

    // Handle retry failure
    if (!retryResult.success) {
      this.handleExecutionFailure(retryResult, requestId, identityId, traceId, duration);
    }

    // Step 3: Parse the response to extract thought and content
    const generateResult = retryResult.value;
    const rawResponse = generateResult?.content || "";
    const result = this.parseResponse(rawResponse);

    // Log successful execution
    this.logExecutionCompletion({
      result,
      rawResponse,
      retryResult,
      requestId,
      identityId,
      traceId,
      duration,
      skillsApplied: skillIds,
    });

    return {
      ...result,
      skillsApplied: skillIds.length > 0 ? skillIds : undefined,
    };
  }

  /**
   * Match and apply skills for the given request
   */
  private async matchAndApplySkills(
    blueprint: IBlueprint,
    request: IParsedRequest,
    identityId: string,
  ): Promise<{ skillIds: string[]; skillsContext: ISkillsContext | null }> {
    if (!this.skillsService || this.disableSkills) {
      return { skillIds: [], skillsContext: null };
    }

    const matchingStartTime = Date.now();
    try {
      let skillIds: string[] = [];
      const matchScores = new Map<string, number>();
      let totalAvailable = 0;

      // 1. Explicit request-level override
      if (request.skills?.length) {
        skillIds = request.skills;
        skillIds.forEach((id) => matchScores.set(id, 1.0));
        totalAvailable = skillIds.length;
      } // 2. Dynamic matching
      else {
        try {
          const result = await this.performDynamicSkillMatching(request, identityId);

          if (result.matches.length > 0) {
            skillIds = result.matches.map((m) => m.skillId);
            result.matches.forEach((m) => matchScores.set(m.skillId, m.confidence));
            totalAvailable = result.totalAvailable;
          } // 3. Fallback to blueprint defaults
          else if (blueprint.defaultSkills?.length) {
            skillIds = blueprint.defaultSkills;
            skillIds.forEach((id) => matchScores.set(id, 0.5));
            totalAvailable = skillIds.length;
          }
        } catch (error) {
          console.warn("[AgentRunner] Skill matching failed or timed out, continuing without skills:", error);
        }
      }

      // 4. Filtering
      if (request.skipSkills?.length) {
        const skip = request.skipSkills;
        skillIds = skillIds.filter((id) => !skip.includes(id));
      }

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
      console.error("[AgentRunner] Skill management critical failure:", error);
      return { skillIds: [], skillsContext: null };
    }
  }

  /**
   * Perform dynamic skill matching with a 500ms timeout guard (Phase 70)
   */
  private async performDynamicSkillMatching(
    request: IParsedRequest,
    identityId: string,
  ): Promise<{ matches: ISkillMatch[]; totalAvailable: number }> {
    const skillsConfig = this.config?.context?.config.get().skills;

    const matchingPromise = this.skillsService!.matchSkills({
      requestText: request.userPrompt,
      keywords: this.extractKeywords(request.userPrompt),
      taskType: request.taskType,
      filePaths: request.filePaths,
      tags: request.tags,
      identityId,
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
    identityId: string,
    traceId: string | undefined,
    requestId: string | undefined,
    skillsApplied: string[],
  ): void {
    this.logActivity(
      ACTIVITY_ACTOR_AGENT,
      AGENT_EVENT_EXECUTION_STARTED,
      requestId || null,
      {
        identity_id: identityId,
        prompt_length: request.userPrompt.length,
        has_context: Object.keys(request.context).length > 0,
        retry_enabled: !this.disableRetry,
        skills_enabled: !this.disableSkills && !!this.skillsService,
        skills_matched: skillsApplied.length,
        skills_applied: skillsApplied,
      },
      traceId,
      identityId,
    );
  }

  /**
   * Execute the model generation with retry logic
   */
  private async executeWithRetry(
    combinedPrompt: string,
    startTime: number,
  ): Promise<IRetryResult<IGenerateResult>> {
    if (this.disableRetry) {
      // Direct execution without retry
      try {
        const rawResponse = await this.modelProvider.generate(combinedPrompt);
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
    } else {
      // Execute with retry policy
      return await this.retryPolicy.execute(
        async () => await this.modelProvider.generate(combinedPrompt),
      );
    }
  }

  /**
   * Handle execution failure by logging and throwing
   */
  private handleExecutionFailure(
    retryResult: IRetryResult<IGenerateResult>,
    requestId: string | undefined,
    identityId: string,
    traceId: string | undefined,
    duration: number,
  ): never {
    this.logActivity(
      ACTIVITY_ACTOR_AGENT,
      "agent.execution_failed",
      requestId || null,
      {
        identity_id: identityId,
        duration_ms: duration,
        total_attempts: retryResult.totalAttempts,
        retry_history: toSafeJson(retryResult.retryHistory),
        error_type: retryResult.error?.constructor.name || DEFAULT_UNKNOWN_LABEL,
        error_message: retryResult.error?.message || DEFAULT_UNKNOWN_ERROR_MESSAGE,
      },
      traceId,
      identityId,
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
    identityId: string;
    traceId: string | undefined;
    duration: number;
    skillsApplied: string[];
  }): void {
    const {
      result,
      rawResponse,
      retryResult,
      requestId,
      identityId,
      traceId,
      duration,
      skillsApplied,
    } = args;
    this.logActivity(
      ACTIVITY_ACTOR_AGENT,
      AGENT_EVENT_EXECUTION_COMPLETED,
      requestId || null,
      {
        identity_id: identityId,
        duration_ms: duration,
        total_attempts: retryResult.totalAttempts,
        retry_history: retryResult.retryHistory.length > 0 ? toSafeJson(retryResult.retryHistory) : null,
        response_length: rawResponse?.length || 0,
        has_thought: result.thought.length > 0,
        has_content: result.content.length > 0,
        skills_applied: skillsApplied.length > 0 ? toSafeJson(skillsApplied) : null,
      },
      traceId,
      identityId,
    );
  }

  /**
   * Construct the combined prompt from blueprint and request
   * @param blueprint - Agent blueprint
   * @param request - User request
   * @param skillContext - Optional skill context to inject (Phase 17)
   * @returns Combined prompt string
   */
  private async constructPrompt(
    blueprint: IBlueprint,
    request: IParsedRequest,
    skillContext?: string,
  ): Promise<string> {
    const k = ContextSegmentKindSchema.enum;
    type SegmentEntry = { content: string; kind: IContextSegment["kind"]; priority: number; nonCompactable: boolean };
    const entries: SegmentEntry[] = [];

    if (blueprint.systemPrompt.trim()) {
      entries.push({ content: blueprint.systemPrompt, kind: k.system, priority: 100, nonCompactable: true });
    }
    if (skillContext?.trim()) {
      entries.push({ content: skillContext, kind: k.request, priority: 50, nonCompactable: false });
    }
    const schemaInstructions = this.planAdapter.getSchemaInstructions();
    entries.push({ content: schemaInstructions, kind: k.acceptance_criteria, priority: 90, nonCompactable: true });

    const portalContext = request.context?.[PORTAL_CONTEXT_KEY];
    if (typeof portalContext === "string" && portalContext.trim()) {
      entries.push({ content: portalContext, kind: k.portal_knowledge, priority: 60, nonCompactable: false });
    }
    const portalKnowledge = request.context?.[PORTAL_KNOWLEDGE_KEY];
    if (typeof portalKnowledge === "string" && portalKnowledge.trim()) {
      entries.push({ content: portalKnowledge, kind: k.portal_knowledge, priority: 60, nonCompactable: false });
    }
    const memoryContext = request.context?.[MEMORY_CONTEXT_KEY];
    if (typeof memoryContext === "string" && memoryContext.trim()) {
      entries.push({ content: memoryContext, kind: k.reflection, priority: 40, nonCompactable: false });
    }
    if (request.userPrompt.trim()) {
      entries.push({ content: request.userPrompt, kind: k.request, priority: 75, nonCompactable: true });
    }

    const manager = this.config?.contextBudgetManager;
    if (!manager) return entries.map((e) => e.content).join("\n\n");

    const segments: IContextSegment[] = entries.map((e, i) => ({
      segmentId: `prompt-part-${i}`,
      content: e.content,
      kind: e.kind,
      priority: e.priority,
      tokenEstimate: Math.ceil(e.content.length / 4),
      metadata: { nonCompactable: e.nonCompactable },
    }));

    const budget: IPromptBudget = {
      model: "default",
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

    const { segments: filtered } = await manager.prepare({
      traceId: request.traceId ?? "unknown",
      stepId: "agent-runner",
      model: "default",
      promptBudget: budget,
      segments,
    });

    return filtered.map((s) => s.content).join("\n\n");
  }

  /**
   * Extract keywords from text for skill matching (Phase 17)
   * @param text - Text to extract keywords from
   * @returns Array of keywords
   */
  private extractKeywords(text: string): string[] {
    return extractKeywords(text);
  }

  /**
   * Parse the LLM response to extract <thought> and <content> tags
   * Falls back to treating the whole response as content if tags are missing
   * Enhanced with Phase 16.2 OutputValidator for consistent parsing.
   * @param rawResponse - Raw response from the LLM
   * @returns Parsed result with thought, content, and raw response
   */
  private parseResponse(rawResponse: string): IAgentExecutionResult {
    // Use OutputValidator for consistent XML parsing (Phase 16.2)
    const parsed = this.outputValidator.parseXMLTags(rawResponse);

    return {
      thought: parsed.thought,
      content: parsed.content,
      raw: parsed.raw,
    };
  }

  /**
   * Get validation metrics from the output validator (Phase 16.2)
   * @returns Current validation metrics
   */
  getValidationMetrics(): IValidationMetrics {
    return this.outputValidator.getMetrics();
  }

  /**
   * Reset validation metrics (Phase 16.2)
   */
  resetValidationMetrics(): void {
    this.outputValidator.resetMetrics();
  }

  /**
   * Log activity to IActivity Journal (if database provided)
   */
  private logActivity(
    actor: string,
    actionType: string,
    target: string | null,
    payload: Record<string, JSONValue>,
    traceId?: string,
    identityId?: string | null,
  ): void {
    if (!this.db) {
      return; // No database, skip logging
    }

    try {
      this.db.logActivity(actor, actionType, target, payload, traceId, identityId || null);
    } catch (error) {
      console.error("[AgentRunner] Failed to log activity:", error);
    }
  }
}

function createNoopPlanAdapter(): IPlanAdapter {
  return {
    parseAndValidate: () => Promise.resolve({ thought: "", content: "", raw: "" }),
    getSchemaInstructions: () => "",
  };
}

export function createAgentRunner(
  planAdapter?: IPlanAdapter,
  modelProvider?: IModelProvider,
  agentConfig?: IAgentRunnerConfig,
): AgentRunner {
  return new AgentRunner(planAdapter, modelProvider, agentConfig);
}
