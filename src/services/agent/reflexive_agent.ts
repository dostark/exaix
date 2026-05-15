/**
 * @module ReflexiveAgent
 * @path src/services/agent/reflexive_agent.ts
 * @description Implements the reflexive agent loop, enabling self-critique and iterative output improvement before finalization.
 * @architectural-layer Services
 * @related-files ["src/services/agent/agent_runner.ts", "src/services/utils/confidence_scorer.ts"]
 */

import { z } from "zod";
import { CritiqueIssueType, CritiqueQuality, CritiqueSeverity } from "@exaix/core";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { JSONValue } from "@exaix/core";
import type { IDatabaseService } from "../core/db.ts";
import {
  AgentRunner,
  type IAgentExecutionResult,
  type IAgentRunner,
  type IAgentRunnerConfig,
  type IBlueprint,
  type IParsedRequest,
} from "./agent_runner.ts";
import { createOutputValidator, type IOutputValidator } from "../tool/output_validator.ts";
import { logDebug } from "@exaix/core/logger/structured_logger.ts";
import { CircuitBreaker } from "@exaix/ai/circuit_breaker.ts";
import { LogMethod } from "../decorators/logging.ts";
import { EventLogger } from "@exaix/core/logger/event_logger.ts";
import { MiddlewarePipeline } from "../middleware/pipeline.ts";
import type { IServiceContext } from "@exaix/core/types";
import { RequirementFulfillmentSchema } from "../../flows/evaluation_criteria.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { Config } from "@exaix/schemas/config.ts";
import {
  DEFAULT_REFLEXIVE_CONVERGENCE_ABSOLUTE_MAX_ITERATIONS,
  DEFAULT_REFLEXIVE_CONVERGENCE_MIN_IMPROVEMENT_DELTA,
  DEFAULT_REFLEXIVE_CONVERGENCE_OSCILLATION_WINDOW,
  DEFAULT_REFLEXIVE_CONVERGENCE_QUALITY_EXIT_THRESHOLD,
  DEFAULT_REFLEXIVE_CONVERGENCE_SCORE_EVERY_N_ITERATIONS,
  MAX_CRITIQUE_REQUIREMENTS,
} from "@exaix/core";
import { type ConfidenceAssessment, ConfidenceScorer } from "../utils/confidence_scorer.ts";

export interface IReflexiveAgentConvergenceConfig {
  qualityExitThreshold: number;
  minImprovementDelta: number;
  oscillationWindow: number;
  baseMaxIterations: number;
  complexityScaleFactor: number;
  absoluteMaxIterations: number;
  scoreEveryNIterations: number;
}

export interface IReflexiveAgentConfig extends IAgentRunnerConfig {
  maxIterations?: number;
  minQuality?: ICritique["quality"];
  confidenceThreshold?: number;
  critiquePromptTemplate?: string;
  refinementPromptTemplate?: string;
  scoreEveryNIterations?: number;
  verbose?: boolean;
  adaptiveIterationBudget?: boolean;
  convergenceConfig?: Partial<IReflexiveAgentConvergenceConfig>;
}

export interface IReflexionIteration {
  iteration: number;
  response: IAgentExecutionResult;
  critique: ICritique | null;
  durationMs: number;
}

export interface IIterationScore {
  iteration: number;
  score: number;
  delta: number | null;
  level: ConfidenceAssessment["level"];
  requiresReview: boolean;
}

type IReflexionConvergenceReason = "quality_threshold_met" | "plateau_detected" | "oscillation_detected";

export interface IReflexiveExecutionResult {
  final: IAgentExecutionResult;
  finalCritique: ICritique | null;
  iterations: IReflexionIteration[];
  totalIterations: number;
  earlyExit: boolean;
  totalDurationMs: number;
  averageConfidence: number;
}

export interface IReflexionMetrics {
  totalExecutions: number;
  totalIterations: number;
  averageIterationsPerExecution: number;
  earlyExitCount: number;
  earlyExitRate: number;
  qualityDistribution: Record<ICritique["quality"], number>;
  issueTypeDistribution: Record<string, number>;
}

const REFLEXIVE_AGENT_ACTIVITY_SOURCE = "reflexive_agent" as const;

// ============================================================================
// Critique Schema
// ============================================================================

/**
 * Schema for critique output from self-evaluation
 */
export const CritiqueSchema = z.object({
  quality: z.nativeEnum(CritiqueQuality),
  confidence: z.number().min(0).max(100),
  passed: z.boolean(),
  issues: z.array(z.object({
    type: z.nativeEnum(CritiqueIssueType),
    severity: z.nativeEnum(CritiqueSeverity),
    description: z.string(),
    suggestion: z.string().optional(),
  })).default([]),
  reasoning: z.string(),
  improvements: z.array(z.string()).optional(),
  /** Structured fulfillment status per goal/AC — populated by enhanced prompt */
  requirementsFulfillment: z.array(RequirementFulfillmentSchema).optional(),
});

export type ICritique = z.infer<typeof CritiqueSchema>;

// ============================================================================
// Reflexive Execution Types
// ============================================================================

// ============================================================================
// Critique Prompt Templates
// ============================================================================

const DEFAULT_CRITIQUE_PROMPT = `You are a quality assurance expert evaluating an AI-generated response.

## Original Request
{request}

## Response to Evaluate
{response}

## Your Task
Critically evaluate the response and provide structured feedback.

Consider:
1. **Accuracy**: Is the information correct and reliable?
2. **Completeness**: Does it fully address the request?
3. **Clarity**: Is it well-organized and easy to understand?
4. **Relevance**: Does it stay focused on the request?
5. **Format**: Does it follow any required formatting?
6. **Logic**: Is the reasoning sound and well-supported?

## Response Format
Respond with a JSON object:
{
  "quality": "${CritiqueQuality.EXCELLENT}" | "${CritiqueQuality.GOOD}" | "${CritiqueQuality.ACCEPTABLE}" | "${CritiqueQuality.NEEDS_IMPROVEMENT}" | "${CritiqueQuality.POOR}",
  "confidence": <0-100>,
  "passed": <true if quality is acceptable or better>,
  "issues": [
    {
      "type": "${CritiqueIssueType.ACCURACY}" | "${CritiqueIssueType.COMPLETENESS}" | "${CritiqueIssueType.CLARITY}" | "${CritiqueIssueType.RELEVANCE}" | "${CritiqueIssueType.FORMAT}" | "${CritiqueIssueType.LOGIC}" | "${CritiqueIssueType.OTHER}",
      "severity": "${CritiqueSeverity.CRITICAL}" | "${CritiqueSeverity.MAJOR}" | "${CritiqueSeverity.MINOR}" | "${CritiqueSeverity.SUGGESTION}",
      "description": "...",
      "suggestion": "..."
    }
  ],
  "reasoning": "Overall assessment explanation",
  "improvements": ["Specific improvement 1", "Specific improvement 2"]
}`;

const DEFAULT_REFINEMENT_PROMPT = `You are refining a previous response based on feedback.

## Original Request
{request}

## Previous Response
{previousResponse}

## Critique Feedback
Quality: {quality}
Confidence: {confidence}%

### Issues Found
{issues}

### Suggested Improvements
{improvements}

## Your Task
Generate an improved response that addresses ALL identified issues.
Focus especially on issues marked as "critical" or "major".

Maintain the same format as the original response, but with improved quality.`;

// ============================================================================
// ReflexiveAgent Class
// ============================================================================

export class ReflexiveAgent {
  public agentRunner: IAgentRunner;
  public critiqueRunner: IAgentRunner;
  public outputValidator: IOutputValidator;
  public readonly agentBreaker: CircuitBreaker;
  public readonly critiqueBreaker: CircuitBreaker;
  public db?: IDatabaseService;

  public config: {
    maxIterations: number;
    minQuality: ICritique["quality"];
    confidenceThreshold: number;
    critiquePromptTemplate: string;
    refinementPromptTemplate: string;
    scoreEveryNIterations: number;
    verbose: boolean;
    adaptiveIterationBudget: boolean;
    convergenceConfig: IReflexiveAgentConvergenceConfig;
    agentRunnerConfig: IAgentRunnerConfig;
  };

  public metrics: IReflexionMetrics = this.emptyMetrics();
  public confidenceScorer: ConfidenceScorer;

  private emptyMetrics(): IReflexionMetrics {
    return {
      totalExecutions: 0,
      totalIterations: 0,
      averageIterationsPerExecution: 0,
      earlyExitCount: 0,
      earlyExitRate: 0,
      qualityDistribution: {
        [CritiqueQuality.EXCELLENT]: 0,
        [CritiqueQuality.GOOD]: 0,
        [CritiqueQuality.ACCEPTABLE]: 0,
        [CritiqueQuality.NEEDS_IMPROVEMENT]: 0,
        [CritiqueQuality.POOR]: 0,
      },
      issueTypeDistribution: {},
    };
  }

  constructor(modelProvider: IModelProvider, config: IReflexiveAgentConfig = {}) {
    const {
      maxIterations = 3,
      minQuality = CritiqueQuality.ACCEPTABLE,
      confidenceThreshold = 70,
      critiquePromptTemplate = DEFAULT_CRITIQUE_PROMPT,
      refinementPromptTemplate = DEFAULT_REFINEMENT_PROMPT,
      scoreEveryNIterations = 1,
      verbose = false,
      adaptiveIterationBudget = true,
      convergenceConfig = {},
      ...agentRunnerConfig
    } = config;

    const effectiveScoreEveryNIterations = Math.max(
      1,
      scoreEveryNIterations ?? convergenceConfig.scoreEveryNIterations ??
        DEFAULT_REFLEXIVE_CONVERGENCE_SCORE_EVERY_N_ITERATIONS,
    );

    this.config = {
      maxIterations,
      minQuality,
      confidenceThreshold,
      critiquePromptTemplate,
      refinementPromptTemplate,
      scoreEveryNIterations: effectiveScoreEveryNIterations,
      verbose,
      adaptiveIterationBudget,
      convergenceConfig: {
        qualityExitThreshold: convergenceConfig.qualityExitThreshold ??
          DEFAULT_REFLEXIVE_CONVERGENCE_QUALITY_EXIT_THRESHOLD,
        minImprovementDelta: convergenceConfig.minImprovementDelta ??
          DEFAULT_REFLEXIVE_CONVERGENCE_MIN_IMPROVEMENT_DELTA,
        oscillationWindow: convergenceConfig.oscillationWindow ?? DEFAULT_REFLEXIVE_CONVERGENCE_OSCILLATION_WINDOW,
        baseMaxIterations: convergenceConfig.baseMaxIterations ?? maxIterations,
        complexityScaleFactor: convergenceConfig.complexityScaleFactor ?? 1,
        absoluteMaxIterations: convergenceConfig.absoluteMaxIterations ??
          DEFAULT_REFLEXIVE_CONVERGENCE_ABSOLUTE_MAX_ITERATIONS,
        scoreEveryNIterations: effectiveScoreEveryNIterations,
      },
      agentRunnerConfig,
    };

    this.db = agentRunnerConfig.db;
    this.confidenceScorer = new ConfidenceScorer(modelProvider, {
      lowConfidenceThreshold: confidenceThreshold,
      highConfidenceThreshold: 90,
      autoReview: false,
      verbose,
    });
    this.agentRunner = new AgentRunner(modelProvider, agentRunnerConfig);
    this.critiqueRunner = new AgentRunner(modelProvider, agentRunnerConfig);
    this.outputValidator = createOutputValidator({ autoRepair: true });

    this.agentBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 60_000,
      halfOpenSuccessThreshold: 2,
    });

    this.critiqueBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 60_000,
      halfOpenSuccessThreshold: 2,
    });
  }

  @LogMethod(new EventLogger({ prefix: "[ReflexiveAgent]" }), "reflexive.run")
  async run(
    blueprint: IBlueprint,
    request: IParsedRequest,
    requestAnalysis?: IRequestAnalysis,
  ): Promise<IReflexiveExecutionResult> {
    // Run reflexive loop through middleware pipeline to centralize timing/error handling
    interface ReflexiveAgentContext extends IServiceContext {
      __startTime?: number;
      __durationMs?: number;
    }
    const pipeline = new MiddlewarePipeline<ReflexiveAgentContext>();

    pipeline.use(async (_ctx, next) => {
      const start = typeof performance !== "undefined" ? performance.now() : Date.now();
      _ctx.__startTime = start;
      await next();
      const end = typeof performance !== "undefined" ? performance.now() : Date.now();
      _ctx.__durationMs = end - _ctx.__startTime;
    });

    pipeline.use(async (_ctx, next) => {
      try {
        await next();
      } catch (err) {
        // Instrumentation or special handling could go here
        throw err;
      }
    });

    const context: ReflexiveAgentContext = { traceId: request.traceId, identityId: blueprint.identityId };

    let finalResult: IReflexiveExecutionResult;

    await pipeline.execute(context, async () => {
      const startTime = performance.now();
      const iterations: IReflexionIteration[] = [];
      const scoreHistory: IIterationScore[] = [];
      let currentResponse: IAgentExecutionResult | null = null;
      let finalCritique: ICritique | null = null;
      let earlyExit = false;
      const effectiveMaxIterations = this.computeEffectiveMaxIterations(requestAnalysis);

      this.logActivity(REFLEXIVE_AGENT_ACTIVITY_SOURCE, "agent.iteration_budget_computed", null, {
        complexity: requestAnalysis?.complexity ?? null,
        configuredMaxIterations: this.config.maxIterations,
        effectiveMaxIterations,
        scoreEveryNIterations: this.config.scoreEveryNIterations,
      }, request.traceId);

      this.metrics.totalExecutions++;

      for (let i = 1; i <= effectiveMaxIterations; i++) {
        const iterationStart = performance.now();

        if (i === 1) {
          currentResponse = await this.agentBreaker.execute(() => this.agentRunner.run(blueprint, request));
        } else {
          currentResponse = await this.refine(blueprint, request, currentResponse!, finalCritique!);
        }

        const critique = await this.critique(request, currentResponse, requestAnalysis);

        const iterationDuration = performance.now() - iterationStart;
        iterations.push({
          iteration: i,
          response: currentResponse,
          critique,
          durationMs: iterationDuration,
        });

        this.metrics.totalIterations++;
        this.updateMetrics(critique);

        if (this.shouldScoreIteration(i)) {
          const previousScore = scoreHistory.length > 0 ? scoreHistory[scoreHistory.length - 1].score : null;
          const assessment = this.scoreIteration(i, currentResponse!, previousScore);
          scoreHistory.push(assessment);

          this.logActivity(REFLEXIVE_AGENT_ACTIVITY_SOURCE, "agent.iteration_scored", null, {
            iteration: assessment.iteration,
            score: assessment.score,
            delta: assessment.delta,
            level: assessment.level,
            requiresReview: assessment.requiresReview,
          }, request.traceId);
        }

        this.logActivity(REFLEXIVE_AGENT_ACTIVITY_SOURCE, "reflexion.iteration", null, {
          iteration: i,
          quality: critique.quality as string,
          confidence: critique.confidence,
          passed: critique.passed,
          issueCount: critique.issues.length,
          durationMs: iterationDuration,
        }, request.traceId);

        if (this.shouldAccept(critique)) {
          finalCritique = critique;
          earlyExit = i < effectiveMaxIterations;
          if (earlyExit) {
            this.metrics.earlyExitCount++;
            this.logActivity(REFLEXIVE_AGENT_ACTIVITY_SOURCE, "agent.converged", null, {
              reason: "quality_threshold_met",
              iteration: i,
              finalQuality: critique.quality,
              finalConfidence: critique.confidence,
              scores: scoreHistory.map((entry) => ({
                iteration: entry.iteration,
                score: entry.score,
                delta: entry.delta,
                level: entry.level,
                requiresReview: entry.requiresReview,
              })),
            }, request.traceId);
          }
          break;
        }

        const convergence = this.detectConvergence(scoreHistory, iterations);
        if (convergence.shouldExit) {
          finalCritique = critique;
          earlyExit = true;
          this.metrics.earlyExitCount++;
          this.logActivity(REFLEXIVE_AGENT_ACTIVITY_SOURCE, "agent.converged", null, {
            reason: convergence.reason,
            iteration: i,
            finalQuality: critique.quality,
            finalConfidence: critique.confidence,
            scores: scoreHistory.map((entry) => ({
              iteration: entry.iteration,
              score: entry.score,
              delta: entry.delta,
              level: entry.level,
              requiresReview: entry.requiresReview,
            })),
          }, request.traceId);
          break;
        }

        finalCritique = critique;
      }

      const totalDuration = performance.now() - startTime;

      this.metrics.earlyExitRate = this.metrics.earlyExitCount / this.metrics.totalExecutions;
      this.metrics.averageIterationsPerExecution = this.metrics.totalIterations / this.metrics.totalExecutions;

      this.logActivity(REFLEXIVE_AGENT_ACTIVITY_SOURCE, "reflexion.complete", null, {
        totalIterations: iterations.length,
        earlyExit,
        finalQuality: (finalCritique?.quality as string) ?? null,
        finalConfidence: finalCritique?.confidence ?? null,
        totalDurationMs: totalDuration,
      }, request.traceId);

      const confidences = iterations.map((it) => it.critique?.confidence ?? 0).filter((c) => c > 0);
      const averageConfidence = confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0;

      finalResult = {
        final: currentResponse!,
        finalCritique,
        iterations,
        totalIterations: iterations.length,
        earlyExit,
        totalDurationMs: totalDuration,
        averageConfidence,
      };
    });

    return finalResult!;
  }

  private buildEnhancedCritiquePrompt(analysis: IRequestAnalysis): string {
    const sortedGoals = [...analysis.goals].sort((a, b) => a.priority - b.priority);
    const goalSlice = sortedGoals.slice(0, MAX_CRITIQUE_REQUIREMENTS);
    const acSlice = analysis.acceptanceCriteria.slice(
      0,
      Math.max(0, MAX_CRITIQUE_REQUIREMENTS - goalSlice.length),
    );

    const goalsSection = goalSlice
      .map((g) => `- ${g.explicit ? "[E]" : "[I]"} ${g.description}`)
      .join("\n");
    const acSection = acSlice.map((ac) => `- ${ac}`).join("\n");

    return "\n\n## Specific Requirements to Verify\n" +
      (goalsSection || "(none)") +
      "\n\n## Acceptance Criteria\n" +
      (acSection || "(none)") +
      "\n\nFor each requirement, state: \u2705 MET / \u26a0\ufe0f PARTIAL / \u274c MISSING" +
      '\nAdd a "requirementsFulfillment" array to your JSON response listing each requirement and its status.';
  }

  public async critique(
    request: IParsedRequest,
    response: IAgentExecutionResult,
    requestAnalysis?: IRequestAnalysis,
  ): Promise<ICritique> {
    let critiquePrompt = this.config.critiquePromptTemplate
      .replace("{request}", request.userPrompt)
      .replace("{response}", response.content);

    // Append structured requirements section when analysis is provided
    if (requestAnalysis) {
      critiquePrompt += this.buildEnhancedCritiquePrompt(requestAnalysis);
    }

    const critiqueBlueprint: IBlueprint = {
      systemPrompt:
        "You are a quality assurance expert. Evaluate responses critically and provide structured JSON feedback.",
      identityId: "critique-evaluator",
    };

    const critiqueRequest: IParsedRequest = {
      userPrompt: critiquePrompt,
      context: {},
      traceId: request.traceId,
    };

    const critiqueResult = await this.critiqueBreaker.execute(() =>
      this.critiqueRunner.run(critiqueBlueprint, critiqueRequest)
    );

    const validationResult = this.outputValidator.validate(critiqueResult.content, CritiqueSchema);

    if (validationResult.success && validationResult.value) {
      return validationResult.value;
    }

    return {
      quality: CritiqueQuality.ACCEPTABLE,
      confidence: 50,
      passed: true,
      issues: [],
      reasoning: "Unable to parse critique response, defaulting to acceptable",
    };
  }

  private async refine(
    blueprint: IBlueprint,
    originalRequest: IParsedRequest,
    previousResponse: IAgentExecutionResult,
    critique: ICritique,
  ): Promise<IAgentExecutionResult> {
    const issuesFormatted = critique.issues
      .map((issue: ICritique["issues"][number]) =>
        `- [${String(issue.severity).toUpperCase()}] ${issue.type}: ${issue.description}${
          issue.suggestion ? ` -> ${issue.suggestion}` : ""
        }`
      )
      .join("\n");

    const improvementsFormatted = critique.improvements?.join("\n- ") || "No specific improvements suggested";

    const refinementPrompt = this.config.refinementPromptTemplate
      .replace("{request}", originalRequest.userPrompt)
      .replace("{previousResponse}", previousResponse.content)
      .replace("{quality}", critique.quality)
      .replace("{confidence}", String(critique.confidence))
      .replace("{issues}", issuesFormatted || "No specific issues listed")
      .replace("{improvements}", improvementsFormatted);

    const refinementRequest: IParsedRequest = {
      userPrompt: refinementPrompt,
      context: originalRequest.context,
      traceId: originalRequest.traceId,
    };

    return await this.agentRunner.run(blueprint, refinementRequest);
  }

  public shouldAccept(critique: ICritique): boolean {
    // Critical issues should always trigger refinement, regardless of confidence/quality
    const hasCriticalIssues = critique.issues.some((issue) => issue.severity === CritiqueSeverity.CRITICAL);
    if (hasCriticalIssues) {
      return false;
    }

    // Check confidence threshold
    if (critique.confidence >= this.config.confidenceThreshold) {
      return true;
    }

    // Check quality level
    const qualityOrder: CritiqueQuality[] = [
      CritiqueQuality.EXCELLENT,
      CritiqueQuality.GOOD,
      CritiqueQuality.ACCEPTABLE,
      CritiqueQuality.NEEDS_IMPROVEMENT,
      CritiqueQuality.POOR,
    ];
    const currentQualityIndex = qualityOrder.indexOf(critique.quality);
    const minQualityIndex = qualityOrder.indexOf(this.config.minQuality);

    if (currentQualityIndex <= minQualityIndex) {
      return true;
    }

    return critique.passed;
  }

  getMetrics(): IReflexionMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = this.emptyMetrics();
  }

  private shouldScoreIteration(iteration: number): boolean {
    return iteration % this.config.scoreEveryNIterations === 0;
  }

  private scoreIteration(
    iteration: number,
    response: IAgentExecutionResult,
    previousScore: number | null,
  ): IIterationScore {
    const assessment = this.confidenceScorer.assessQuick(response.content);
    return {
      iteration,
      score: assessment.score,
      delta: previousScore === null ? null : assessment.score - previousScore,
      level: assessment.level,
      requiresReview: assessment.requires_review,
    };
  }

  private detectConvergence(
    scoreHistory: IIterationScore[],
    iterations: IReflexionIteration[],
  ): { shouldExit: boolean; reason?: IReflexionConvergenceReason } {
    if (scoreHistory.length < 2) return { shouldExit: false };

    const previous = scoreHistory[scoreHistory.length - 2];
    const latest = scoreHistory[scoreHistory.length - 1];
    const lastIterations = iterations.slice(-2);

    if (lastIterations.length < 2) return { shouldExit: false };
    const [previousIteration, latestIteration] = lastIterations;

    if (!previousIteration.critique || !latestIteration.critique) return { shouldExit: false };
    if (this.hasRecentCriticalIssue(previousIteration, latestIteration)) return { shouldExit: false };

    if (latest.score >= this.config.convergenceConfig.qualityExitThreshold) {
      return { shouldExit: true, reason: "quality_threshold_met" };
    }

    if (!this.isEligibleForConvergence(latestIteration.critique)) {
      return { shouldExit: false };
    }

    if (scoreHistory.length < this.config.convergenceConfig.oscillationWindow) {
      return { shouldExit: false };
    }

    if (this.isOscillation(previous, latest)) {
      return { shouldExit: true, reason: "oscillation_detected" };
    }

    if (this.isPlateau(previousIteration, latestIteration, previous, latest)) {
      return { shouldExit: true, reason: "plateau_detected" };
    }

    return { shouldExit: false };
  }

  private hasRecentCriticalIssue(
    previousIteration: IReflexionIteration,
    latestIteration: IReflexionIteration,
  ): boolean {
    return [previousIteration, latestIteration].some((iteration) =>
      iteration.critique?.issues.some((issue) => issue.severity === CritiqueSeverity.CRITICAL)
    );
  }

  private isEligibleForConvergence(critique: ICritique): boolean {
    const acceptableQualities = [
      CritiqueQuality.EXCELLENT,
      CritiqueQuality.GOOD,
      CritiqueQuality.ACCEPTABLE,
    ];

    return acceptableQualities.includes(critique.quality);
  }

  private isOscillation(previous: IIterationScore, latest: IIterationScore): boolean {
    return (
      previous.delta !== null &&
      latest.delta !== null &&
      Math.sign(previous.delta) !== Math.sign(latest.delta) &&
      Math.abs(previous.delta) <= this.config.convergenceConfig.minImprovementDelta &&
      Math.abs(latest.delta) <= this.config.convergenceConfig.minImprovementDelta
    );
  }

  private isPlateau(
    previousIteration: IReflexionIteration,
    latestIteration: IReflexionIteration,
    previous: IIterationScore,
    latest: IIterationScore,
  ): boolean {
    const stableQuality = latestIteration.critique!.quality === previousIteration.critique!.quality;
    const samePassStatus = latestIteration.critique!.passed === previousIteration.critique!.passed;
    const deltaAbs = Math.abs(latest.score - previous.score);

    return stableQuality && samePassStatus && latest.score >= previous.score &&
      deltaAbs <= this.config.convergenceConfig.minImprovementDelta;
  }

  public updateMetrics(critique: ICritique): void {
    this.metrics.qualityDistribution[critique.quality]++;
    for (const issue of critique.issues) {
      this.metrics.issueTypeDistribution[issue.type] = (this.metrics.issueTypeDistribution[issue.type] || 0) + 1;
    }
  }

  private computeEffectiveMaxIterations(requestAnalysis?: IRequestAnalysis): number {
    const baseIterations = this.config.convergenceConfig.baseMaxIterations;
    if (!this.config.adaptiveIterationBudget || !requestAnalysis?.complexity) {
      return Math.min(baseIterations, this.config.convergenceConfig.absoluteMaxIterations);
    }

    const complexityWeight = (() => {
      switch (requestAnalysis.complexity) {
        case "simple":
          return -1;
        case "medium":
          return 0;
        case "complex":
          return 1;
        case "epic":
          return 2;
        default:
          return 0;
      }
    })();

    const scaledAdjustment = Math.round(complexityWeight * this.config.convergenceConfig.complexityScaleFactor);
    const effectiveMax = Math.max(1, baseIterations + scaledAdjustment);
    return Math.min(effectiveMax, this.config.convergenceConfig.absoluteMaxIterations);
  }

  public logActivity(
    actor: string,
    actionType: string,
    target: string | null,
    payload: Record<string, JSONValue>,
    traceId?: string,
  ): void {
    if (this.config.verbose) {
      logDebug(`Reflexive agent activity: [${actor}] ${actionType}`, {
        actor,
        action_type: actionType,
        target,
        payload,
        trace_id: traceId ?? null,
        agent_type: "reflexive-agent",
      });
    }

    if (this.db) {
      this.db.logActivity(actor, actionType, target, payload, traceId, "reflexive-agent");
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createReflexiveAgent(
  modelProvider: IModelProvider,
  config?: IReflexiveAgentConfig,
): ReflexiveAgent {
  return new ReflexiveAgent(modelProvider, config);
}

export function createCodeReviewReflexiveAgent(
  modelProvider: IModelProvider,
  config?: IReflexiveAgentConfig,
): ReflexiveAgent {
  return new ReflexiveAgent(modelProvider, {
    maxIterations: 2,
    minQuality: CritiqueQuality.GOOD,
    confidenceThreshold: 80,
    ...config,
  });
}

export function createHighQualityReflexiveAgent(
  modelProvider: IModelProvider,
  config?: IReflexiveAgentConfig,
): ReflexiveAgent {
  return new ReflexiveAgent(modelProvider, {
    maxIterations: 5,
    minQuality: CritiqueQuality.EXCELLENT,
    confidenceThreshold: 90,
    ...config,
  });
}

export function createReflexiveAgentFromConfig(
  modelProvider: IModelProvider,
  config: Config,
  overrides: IReflexiveAgentConfig = {},
): ReflexiveAgent {
  const convergence = config.agents.convergence ?? {};
  return new ReflexiveAgent(modelProvider, {
    maxIterations: overrides.maxIterations ?? convergence.base_max_iterations ?? config.agents.max_iterations,
    scoreEveryNIterations: overrides.scoreEveryNIterations ?? convergence.score_every_n_iterations,
    convergenceConfig: {
      qualityExitThreshold: convergence.quality_exit_threshold,
      minImprovementDelta: convergence.min_improvement_delta,
      oscillationWindow: convergence.oscillation_window,
      baseMaxIterations: convergence.base_max_iterations,
      complexityScaleFactor: convergence.complexity_scale_factor,
      absoluteMaxIterations: convergence.absolute_max_iterations,
      scoreEveryNIterations: convergence.score_every_n_iterations,
      ...overrides.convergenceConfig,
    },
    ...overrides,
  });
}
