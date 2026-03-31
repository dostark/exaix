/**
 * @module ConfidenceScorer
 * @path src/services/confidence_scorer.ts
 * @description Evaluates agent outputs to extract confidence scores and reasoning, flagging low-confidence results for human review.
 * @architectural-layer Services
 * @dependencies [providers, db, agent_runner, output_validator, enums, constants]
 * @related-files [src/services/agent/agent_runner.ts, src/services/agent/reflexive_agent.ts]
 */

import { z } from "zod";
import { IModelProvider } from "../../ai/types.ts";
import type { DatabaseService } from "../core/db.ts";
import { AgentRunner, type IBlueprint, type IParsedRequest } from "../agent/agent_runner.ts";
import { createOutputValidator, OutputValidator } from "../tool/output_validator.ts";
import { logDebug } from "../logger/structured_logger.ts";
import { ConfidenceAssessmentLevel, FactorImpact } from "../../shared/enums.ts";

export interface IConfidenceScorerConfig {
  lowConfidenceThreshold?: number;
  veryLowThreshold?: number;
  highConfidenceThreshold?: number;
  autoReview?: boolean;
  extractionPromptTemplate?: string;
  verbose?: boolean;
  db?: DatabaseService;
  existingScoreWeight?: number;
  goalAlignmentWeight?: number;
}

export interface IConfidenceResult {
  content: string;
  confidence: ConfidenceAssessment;
  flaggedForReview: boolean;
  extractedAt: Date;
}

export interface IAggregatedConfidence {
  average: number;
  min: number;
  max: number;
  weighted: number;
  level: ConfidenceAssessmentLevel;
  sources: Array<{
    identityId: string;
    score: number;
    weight: number;
  }>;
  anyFlaggedForReview: boolean;
}

export interface IConfidenceMetrics {
  totalAssessments: number;
  averageScore: number;
  flaggedCount: number;
  flaggedRate: number;
  levelDistribution: Record<ConfidenceAssessmentLevel, number>;
}
import {
  CONFIDENCE_ADJUSTMENT_CERTAIN,
  CONFIDENCE_ADJUSTMENT_HEDGING,
  CONFIDENCE_ADJUSTMENT_QUALIFIER,
  CONFIDENCE_ADJUSTMENT_QUESTION,
  CONFIDENCE_ADJUSTMENT_SHORT,
  CONFIDENCE_ADJUSTMENT_UNCERTAIN,
  CONFIDENCE_ADJUSTMENT_VERY_SHORT,
  CONFIDENCE_DEFAULT_HIGH_THRESHOLD,
  CONFIDENCE_DEFAULT_LOW_THRESHOLD,
  CONFIDENCE_DEFAULT_VERY_LOW_THRESHOLD,
  CONFIDENCE_LENGTH_THRESHOLD_SHORT,
  CONFIDENCE_LENGTH_THRESHOLD_VERY_SHORT,
  CONFIDENCE_SCORE_BASE,
  CONFIDENCE_THRESHOLD_HIGH,
  CONFIDENCE_THRESHOLD_LOW,
  CONFIDENCE_THRESHOLD_MEDIUM,
  CONFIDENCE_THRESHOLD_VERY_LOW,
  EXISTING_SCORE_CONFIDENCE_WEIGHT,
  GOAL_ALIGNMENT_CONFIDENCE_WEIGHT,
} from "../../shared/constants.ts";
import type { ICritique } from "../agent/reflexive_agent.ts";

// ============================================================================
// Confidence Schema
// ============================================================================

/**
 * Schema for confidence assessment output
 */
export const ConfidenceSchema = z.object({
  score: z.number().min(0).max(100),
  level: z.nativeEnum(ConfidenceAssessmentLevel),
  reasoning: z.string(),
  factors: z.array(z.object({
    name: z.string(),
    impact: z.nativeEnum(FactorImpact),
    weight: z.number().min(0).max(1),
    description: z.string(),
  })).default([]),
  uncertainty_areas: z.array(z.string()).default([]),
  requires_review: z.boolean(),
});

export type ConfidenceAssessment = z.infer<typeof ConfidenceSchema>;

// ============================================================================
// Configuration Types
// ============================================================================

// ============================================================================
// Default Prompt Template
// ============================================================================

const DEFAULT_EXTRACTION_PROMPT = `You are analyzing an AI-generated response to assess confidence level.

## Original Request
{request}

## Response to Assess
{response}

## Your Task
Assess the confidence level of this response. Consider:

1. **Knowledge Certainty**: Is the response based on well-established facts or uncertain information?
2. **Completeness**: Does the response fully address the request?
3. **Evidence Quality**: Are claims supported by concrete evidence or reasoning?
4. **Ambiguity**: Is the response clear and unambiguous?
5. **Limitations Acknowledged**: Does the response acknowledge its limitations?

## Response Format
Respond with a JSON object:
{
  "score": <0-100 confidence score>,
  "level": "one of: very_high, high, medium, low, or very_low",
  "reasoning": "Why this confidence level was assigned",
  "factors": [
    {
      "name": "factor name",
      "impact": "one of: positive, negative, or neutral",
      "weight": <0-1 importance>,
      "description": "How this factor affects confidence"
    }
  ],
  "uncertainty_areas": ["area 1", "area 2"],
  "requires_review": <true if human should verify>
}

Scoring Guidelines:
- 90-100: Very high confidence - well-established facts, clear answer
- 70-89: High confidence - reliable but some minor uncertainties
- 50-69: Medium confidence - reasonable answer but notable gaps
- 30-49: Low confidence - significant uncertainties or assumptions
- 0-29: Very low confidence - speculative, requires verification`;

// ============================================================================
// ConfidenceScorer Class
// ============================================================================

export class ConfidenceScorer {
  private agentRunner: AgentRunner;
  private outputValidator: OutputValidator;

  private config: {
    lowConfidenceThreshold: number;
    veryLowThreshold: number;
    highConfidenceThreshold: number;
    autoReview: boolean;
    extractionPromptTemplate: string;
    verbose: boolean;
    db?: DatabaseService;
    existingScoreWeight: number;
    goalAlignmentWeight: number;
  };

  private metrics: IConfidenceMetrics = this.emptyMetrics();

  private emptyMetrics(): IConfidenceMetrics {
    return {
      totalAssessments: 0,
      averageScore: 0,
      flaggedCount: 0,
      flaggedRate: 0,
      levelDistribution: {
        [ConfidenceAssessmentLevel.VERY_HIGH]: 0,
        [ConfidenceAssessmentLevel.HIGH]: 0,
        [ConfidenceAssessmentLevel.MEDIUM]: 0,
        [ConfidenceAssessmentLevel.LOW]: 0,
        [ConfidenceAssessmentLevel.VERY_LOW]: 0,
      },
    };
  }

  private scoreSum = 0;

  constructor(modelProvider: IModelProvider, config: IConfidenceScorerConfig = {}) {
    const {
      lowConfidenceThreshold = CONFIDENCE_DEFAULT_LOW_THRESHOLD,
      veryLowThreshold = CONFIDENCE_DEFAULT_VERY_LOW_THRESHOLD,
      highConfidenceThreshold = CONFIDENCE_DEFAULT_HIGH_THRESHOLD,
      autoReview = true,
      extractionPromptTemplate = DEFAULT_EXTRACTION_PROMPT,
      verbose = false,
      db,
      existingScoreWeight = EXISTING_SCORE_CONFIDENCE_WEIGHT,
      goalAlignmentWeight = GOAL_ALIGNMENT_CONFIDENCE_WEIGHT,
    } = config;

    this.config = {
      lowConfidenceThreshold,
      veryLowThreshold,
      highConfidenceThreshold,
      autoReview,
      extractionPromptTemplate,
      verbose,
      db,
      existingScoreWeight,
      goalAlignmentWeight,
    };

    this.agentRunner = new AgentRunner(modelProvider, { db });
    this.outputValidator = createOutputValidator({ autoRepair: true });
  }

  /** */
  async assess(
    request: string,
    response: string,
    traceId?: string,
    critique?: ICritique,
  ): Promise<IConfidenceResult> {
    const assessmentPrompt = this.config.extractionPromptTemplate
      .replace("{request}", request)
      .replace("{response}", response);

    const blueprint: IBlueprint = {
      systemPrompt: "You are an expert at assessing AI response confidence. Provide structured JSON output.",
      identityId: "confidence-assessor",
    };

    const parsedRequest: IParsedRequest = {
      userPrompt: assessmentPrompt,
      context: {},
      traceId,
    };

    const result = await this.agentRunner.run(blueprint, parsedRequest);

    const validationResult = this.outputValidator.validate(result.content, ConfidenceSchema);

    let confidence: ConfidenceAssessment;
    if (validationResult.success && validationResult.value) {
      confidence = validationResult.value;
    } else {
      confidence = this.createDefaultAssessment();
    }

    const fulfillment = critique?.requirementsFulfillment;
    if (fulfillment && fulfillment.length > 0) {
      const metCount = fulfillment.filter((r) => r.status === "MET").length +
        0.5 * fulfillment.filter((r) => r.status === "PARTIAL").length;
      const goalAlignmentScore = metCount / fulfillment.length;
      confidence = {
        ...confidence,
        score: Math.max(
          0,
          Math.min(
            100,
            Math.round(
              confidence.score * this.config.existingScoreWeight +
                goalAlignmentScore * this.config.goalAlignmentWeight * 100,
            ),
          ),
        ),
      };
    }

    const flaggedForReview = this.shouldFlagForReview(confidence);

    this.updateMetrics(confidence, flaggedForReview);

    if (this.config.verbose) {
      logDebug(`Confidence score: ${confidence.score}, Level: ${confidence.level}, Flagged: ${flaggedForReview}`, {
        confidence_score: confidence.score,
        confidence_level: confidence.level,
        flagged_for_review: flaggedForReview,
        service: "confidence_scorer",
      });
    }

    if (this.config.db && flaggedForReview) {
      this.config.db.logActivity(
        "confidence_scorer",
        "confidence.flagged",
        null,
        {
          score: confidence.score,
          level: confidence.level,
          reasoning: confidence.reasoning,
          uncertainty_areas: confidence.uncertainty_areas,
        },
        traceId,
        "confidence-assessor",
      );
    }

    return {
      content: response,
      confidence,
      flaggedForReview,
      extractedAt: new Date(),
    };
  }

  /**
   * Quick assessment without LLM call - based on heuristics
   */
  assessQuick(response: string): ConfidenceAssessment {
    let score = CONFIDENCE_SCORE_BASE;

    const indicators = {
      certainWords: ["definitely", "certainly", "absolutely", "always", "never"],
      uncertainWords: ["maybe", "perhaps", "possibly", "might", "could be", "not sure", "uncertain"],
      hedgingWords: ["I think", "I believe", "probably", "likely", "seems"],
      qualifiers: ["however", "although", "but", "on the other hand"],
    };

    const lowered = response.toLowerCase();

    for (const word of indicators.certainWords) {
      if (lowered.includes(word)) score += CONFIDENCE_ADJUSTMENT_CERTAIN;
    }

    for (const word of indicators.uncertainWords) {
      if (lowered.includes(word)) score += CONFIDENCE_ADJUSTMENT_UNCERTAIN;
    }

    for (const word of indicators.hedgingWords) {
      if (lowered.includes(word)) score += CONFIDENCE_ADJUSTMENT_HEDGING;
    }

    for (const word of indicators.qualifiers) {
      if (lowered.includes(word)) score += CONFIDENCE_ADJUSTMENT_QUALIFIER;
    }

    if (response.includes("?") && !response.includes('?"')) {
      score += CONFIDENCE_ADJUSTMENT_QUESTION;
    }

    if (response.length < CONFIDENCE_LENGTH_THRESHOLD_SHORT) score += CONFIDENCE_ADJUSTMENT_SHORT;
    if (response.length < CONFIDENCE_LENGTH_THRESHOLD_VERY_SHORT) score += CONFIDENCE_ADJUSTMENT_VERY_SHORT;

    score = Math.max(0, Math.min(100, score));

    return {
      score,
      level: this.scoreToLevel(score),
      reasoning: "Quick heuristic-based assessment",
      factors: [],
      uncertainty_areas: [],
      requires_review: score < this.config.lowConfidenceThreshold,
    };
  }

  /**
   * Aggregate confidence from multiple sources
   */
  aggregate(
    confidences: Array<{ identityId: string; confidence: ConfidenceAssessment; weight?: number }>,
  ): IAggregatedConfidence {
    if (confidences.length === 0) {
      return {
        average: 0,
        min: 0,
        max: 0,
        weighted: 0,
        level: ConfidenceAssessmentLevel.VERY_LOW,
        sources: [],
        anyFlaggedForReview: false,
      };
    }

    const scores = confidences.map((c) => c.confidence.score);
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;
    const min = Math.min(...scores);
    const max = Math.max(...scores);

    const totalWeight = confidences.reduce((sum, c) => sum + (c.weight ?? 1), 0);
    const weighted = confidences.reduce((sum, c) => {
      const w = c.weight ?? 1;
      return sum + (c.confidence.score * w);
    }, 0) / totalWeight;

    const anyFlaggedForReview = confidences.some((c) => c.confidence.requires_review);

    return {
      average,
      min,
      max,
      weighted,
      level: this.scoreToLevel(weighted),
      sources: confidences.map((c) => ({
        identityId: c.identityId,
        score: c.confidence.score,
        weight: c.weight ?? 1,
      })),
      anyFlaggedForReview,
    };
  }

  /**
   * Create confidence-aware wrapper for agent execution
   */
  wrapWithConfidence(
    agentRunner: AgentRunner,
  ): (blueprint: IBlueprint, request: IParsedRequest) => Promise<IConfidenceResult> {
    return async (blueprint: IBlueprint, request: IParsedRequest): Promise<IConfidenceResult> => {
      const result = await agentRunner.run(blueprint, request);
      return await this.assess(request.userPrompt, result.content, request.traceId);
    };
  }

  getMetrics(): IConfidenceMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = this.emptyMetrics();
    this.scoreSum = 0;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private shouldFlagForReview(confidence: ConfidenceAssessment): boolean {
    if (!this.config.autoReview) return false;

    if (confidence.requires_review) return true;

    if (confidence.score < this.config.lowConfidenceThreshold) return true;

    return false;
  }

  private scoreToLevel(score: number): ConfidenceAssessmentLevel {
    if (score >= CONFIDENCE_THRESHOLD_HIGH) return ConfidenceAssessmentLevel.VERY_HIGH;
    if (score >= this.config.highConfidenceThreshold) return ConfidenceAssessmentLevel.HIGH;
    if (score >= this.config.lowConfidenceThreshold) return ConfidenceAssessmentLevel.MEDIUM;
    if (score >= this.config.veryLowThreshold) return ConfidenceAssessmentLevel.LOW;
    return ConfidenceAssessmentLevel.VERY_LOW;
  }

  private createDefaultAssessment(): ConfidenceAssessment {
    return {
      score: CONFIDENCE_DEFAULT_LOW_THRESHOLD,
      level: ConfidenceAssessmentLevel.MEDIUM,
      reasoning: "Unable to parse confidence assessment, defaulting to medium",
      factors: [],
      uncertainty_areas: [],
      requires_review: true,
    };
  }

  private updateMetrics(confidence: ConfidenceAssessment, flagged: boolean): void {
    this.metrics.totalAssessments++;
    this.scoreSum += confidence.score;
    this.metrics.averageScore = this.scoreSum / this.metrics.totalAssessments;
    this.metrics.levelDistribution[confidence.level]++;

    if (flagged) {
      this.metrics.flaggedCount++;
    }
    this.metrics.flaggedRate = this.metrics.flaggedCount / this.metrics.totalAssessments;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createConfidenceScorer(
  modelProvider: IModelProvider,
  config?: IConfidenceScorerConfig,
): ConfidenceScorer {
  return new ConfidenceScorer(modelProvider, config);
}

export function createStrictConfidenceScorer(
  modelProvider: IModelProvider,
  config?: IConfidenceScorerConfig,
): ConfidenceScorer {
  return new ConfidenceScorer(modelProvider, {
    lowConfidenceThreshold: CONFIDENCE_THRESHOLD_MEDIUM,
    veryLowThreshold: CONFIDENCE_THRESHOLD_LOW,
    highConfidenceThreshold: CONFIDENCE_THRESHOLD_HIGH,
    autoReview: true,
    ...config,
  });
}

export function createLenientConfidenceScorer(
  modelProvider: IModelProvider,
  config?: IConfidenceScorerConfig,
): ConfidenceScorer {
  return new ConfidenceScorer(modelProvider, {
    lowConfidenceThreshold: CONFIDENCE_THRESHOLD_VERY_LOW,
    veryLowThreshold: 15,
    highConfidenceThreshold: CONFIDENCE_THRESHOLD_MEDIUM,
    autoReview: false,
    ...config,
  });
}
