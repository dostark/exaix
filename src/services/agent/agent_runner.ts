/**
 * @module AgentRunner
 * @path src/services/agent/agent_runner.ts
 * @description Core orchestrator for agent logic.
 *
 * Features:
 * - Load blueprints and system prompts
 * - Execute LLM calls with retry logic
 * - Validate and repair structured output
 * - Handle agent feedback loops
 *
 * @architectural-layer Services
 * * @related-files [src/services/request_processor.ts, src/services/blueprint_loader.ts]
 */

import type { IModelProvider } from "../../ai/types.ts";
import { type JSONValue, toSafeJson } from "../../shared/types/json.ts";
import type { IApplicationContext } from "../../shared/interfaces/i_application_context.ts";
import type { IDatabaseService } from "../../shared/interfaces/i_database_service.ts";
import {
  createLLMRetryPolicy,
  createRetryPolicy,
  type IRetryContext,
  type IRetryPolicy,
  type IRetryPolicyConfig,
  type IRetryResult,
} from "../core/retry_policy.ts";

import { createOutputValidator, type IOutputValidator, type IValidationMetrics } from "../tool/output_validator.ts";
import type { ISkillsService } from "../../shared/interfaces/i_skills_service.ts";
import { extractKeywords } from "../../helpers/text.ts";
import {
  ACTIVITY_ACTOR_AGENT,
  AGENT_EVENT_EXECUTION_COMPLETED,
  AGENT_EVENT_EXECUTION_STARTED,
  DEFAULT_UNKNOWN_ERROR_MESSAGE,
  DEFAULT_UNKNOWN_LABEL,
  PORTAL_CONTEXT_KEY,
  PORTAL_KNOWLEDGE_KEY,
} from "../../shared/constants.ts";
import { PlanAdapter } from "../plan/plan_adapter.ts";

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
  private planAdapter: PlanAdapter;

  private modelProvider: IModelProvider;

  constructor(
    modelProvider?: IModelProvider,
    config?: IAgentRunnerConfig,
  ) {
    const ctx = config?.context;
    const provider = modelProvider || ctx?.provider;
    if (!provider) {
      throw new Error("AgentRunner requires a model provider");
    }
    this.modelProvider = provider;
    this.db = ctx?.db || config?.db;
    this.disableRetry = config?.disableRetry ?? false;
    this.skillsService = ctx?.skills || config?.skillsService;
    this.disableSkills = config?.disableSkills ?? false;
    this.retryPolicy = config?.retryPolicyInstance ||
      (config?.retryPolicy ? createRetryPolicy(config.retryPolicy) : createLLMRetryPolicy());
    this.outputValidator = config?.outputValidatorInstance || createOutputValidator({ autoRepair: true });
    this.planAdapter = new PlanAdapter();

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

    // Phase 17: Match skills based on request context
    const skillsApplied = await this.matchAndApplySkills(blueprint, request, identityId);

    // Log agent execution start
    this.logExecutionStart(request, identityId, traceId, requestId, skillsApplied);

    // Step 1: Construct the combined prompt (with skill context)
    const skillContext = skillsApplied.length > 0 && this.skillsService
      ? await this.skillsService.buildSkillContext(skillsApplied)
      : "";
    const combinedPrompt = this.constructPrompt(blueprint, request, skillContext);

    // Step 2: Execute via the model provider (with retry if enabled)
    const retryResult = await this.executeWithRetry(combinedPrompt, startTime);

    const duration = Date.now() - startTime;

    // Handle retry failure
    if (!retryResult.success) {
      this.handleExecutionFailure(retryResult, requestId, identityId, traceId, duration);
    }

    // Step 3: Parse the response to extract thought and content
    const rawResponse = retryResult.value!;
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
      skillsApplied,
    });

    return {
      ...result,
      skillsApplied: skillsApplied.length > 0 ? skillsApplied : undefined,
    };
  }

  /**
   * Match and apply skills for the given request
   */
  private async matchAndApplySkills(
    blueprint: IBlueprint,
    request: IParsedRequest,
    identityId: string,
  ): Promise<string[]> {
    if (!this.skillsService || this.disableSkills) {
      return [];
    }

    try {
      let skillsApplied: string[] = [];

      // Step 1: Check for request-level explicit skills override
      if (request.skills && request.skills.length > 0) {
        // Use explicit skills from request
        skillsApplied = request.skills;
      } else {
        // Step 2: Try trigger-based matching
        const matchedSkills = await this.skillsService.matchSkills({
          requestText: request.userPrompt,
          keywords: this.extractKeywords(request.userPrompt),
          taskType: request.taskType,
          filePaths: request.filePaths,
          tags: request.tags,
          identityId,
        });

        if (matchedSkills.length > 0) {
          skillsApplied = matchedSkills.map((m) => m.skillId);
        } else if (blueprint.defaultSkills && blueprint.defaultSkills.length > 0) {
          // Step 3: Fall back to blueprint default skills if no matches
          skillsApplied = blueprint.defaultSkills;
        }
      }

      // Step 4: Filter out skipped skills
      if (request.skipSkills && request.skipSkills.length > 0) {
        skillsApplied = skillsApplied.filter((s) => !request.skipSkills!.includes(s));
      }

      if (skillsApplied.length > 0) {
        // Record skill usage
        for (const skillId of skillsApplied) {
          await this.skillsService.recordSkillUsage(skillId);
        }
      }

      return skillsApplied;
    } catch (error) {
      console.error("[AgentRunner] Skill matching failed:", error);
      // Continue without skills - non-fatal error
      return [];
    }
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
  ): Promise<IRetryResult<string>> {
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
    retryResult: IRetryResult<string>,
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
    retryResult: IRetryResult<string>;
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
  private constructPrompt(
    blueprint: IBlueprint,
    request: IParsedRequest,
    skillContext?: string,
  ): string {
    // Combination: system prompt first, then skill context, then user prompt
    // Separated by double newlines for clarity
    const parts: string[] = [];

    if (blueprint.systemPrompt.trim()) {
      parts.push(blueprint.systemPrompt);
    }

    // Inject skill context after system prompt (Phase 17)
    if (skillContext?.trim()) {
      parts.push(skillContext);
    }

    // Inject strict JSON schema instructions for all plans
    parts.push(this.planAdapter.getSchemaInstructions());

    const portalContext = request.context?.[PORTAL_CONTEXT_KEY];
    if (typeof portalContext === "string" && portalContext.trim()) {
      parts.push(portalContext);
    }

    const portalKnowledge = request.context?.[PORTAL_KNOWLEDGE_KEY];
    if (typeof portalKnowledge === "string" && portalKnowledge.trim()) {
      parts.push(portalKnowledge);
    }

    if (request.userPrompt.trim()) {
      parts.push(request.userPrompt);
    }

    return parts.join("\n\n");
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
