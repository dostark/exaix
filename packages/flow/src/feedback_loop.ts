/**
 * @module FeedbackLoop
 * @path packages/flow/src/feedback_loop.ts
 * @description Implements the Reflexion pattern for iterative improvement of agent outputs based on judge feedback and target quality scores.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/gate_evaluator.ts, packages/core/src/evaluation/mod.ts]
 */

import { z } from "zod";
import { type EvaluationCriterion, EvaluationCriterionSchema, getCriteriaByNames } from "@exaix/core/evaluation";
import { FlowGateOnFail, GeneralStatus, ICON_FAILURE, ICON_SUCCESS } from "@exaix/core";
import type { GateEvaluator } from "./gate_evaluator.ts";
import type { IGateResult } from "@exaix/core/types";
import type { CriterionResult } from "@exaix/core/evaluation";

/**
 * Context data for agent requests
 */
export interface IAgentRequestContext {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | IAgentRequestContext
    | (string | number | boolean | null | undefined | IAgentRequestContext)[]
    | string[];
}

/**
 * Feedback loop configuration schema
 */
export const FeedbackLoopConfigSchema = z.object({
  /** Maximum number of improvement iterations */
  maxIterations: z.number().int().min(1).max(10).default(3),
  /** Target score to achieve (0.0 - 1.0) */
  targetScore: z.number().min(0).max(1).default(0.9),
  /** Judge agent ID */
  evaluator: z.string(),
  /** Criteria to evaluate against */
  criteria: z.array(z.union([z.string(), EvaluationCriterionSchema])),
  /** Minimum score improvement to continue looping */
  minImprovement: z.number().min(0).max(1).default(0.05),
  /** Whether to include previous attempts in context */
  includePreviousAttempts: z.boolean().default(true),
});

export type FeedbackLoopConfig = z.infer<typeof FeedbackLoopConfigSchema>;

/**
 * Result of a single iteration
 */
export interface IIterationResult {
  iteration: number;
  content: string;
  gateResult: IGateResult;
  improvement: number;
  durationMs: number;
}

/**
 * Result of the feedback loop
 */
export interface FeedbackLoopResult {
  /** Whether target score was achieved */
  success: boolean;
  /** Final content after all iterations */
  finalContent: string;
  /** Final evaluation score */
  finalScore: number;
  /** Total number of iterations run */
  totalIterations: number;
  /** Results from each iteration */
  iterations: IIterationResult[];
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Reason for stopping */
  stopReason:
    | "target-reached"
    | "max-iterations"
    | "no-improvement"
    | "score-degraded"
    | "error";
}

/**
 * Interface for improvement agent
 */
export interface ImprovementAgent {
  improve(
    originalRequest: string,
    currentContent: string,
    feedback: string,
    iteration: number,
  ): Promise<string>;
}

/**
 * FeedbackLoop - Implements iterative improvement through evaluation
 *
 * The Reflexion pattern:
 * 1. Generate initial response
 * 2. Evaluate against criteria
 * 3. If below target, generate improvement based on feedback
 * 4. Repeat until target reached or max iterations
 */
export class FeedbackLoop {
  constructor(
    private gateEvaluator: GateEvaluator,
    private improvementAgent: ImprovementAgent,
  ) {}

  /**
   * Run feedback loop
   *
   * @param config - Loop configuration
   * @param initialContent - Initial content to improve
   * @param originalRequest - Original user request for context
   */
  async run(
    config: FeedbackLoopConfig,
    initialContent: string,
    originalRequest: string,
  ): Promise<FeedbackLoopResult> {
    const startTime = performance.now();
    const iterations: IIterationResult[] = [];

    let currentContent = initialContent;
    let previousScore = 0;

    // Resolve criteria (used internally by gateEvaluator)
    const _criteria = this.resolveCriteria(config.criteria);

    for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
      const iterationStart = performance.now();

      // Evaluate current content
      const gateResult = await this.gateEvaluator.evaluate(
        {
          identity: config.evaluator,
          criteria: config.criteria,
          threshold: config.targetScore,
          onFail: FlowGateOnFail.CONTINUE_WITH_WARNING,
          maxRetries: 1,
          includeRequestCriteria: false,
        },
        currentContent,
        originalRequest,
      );

      const improvement = gateResult.score - previousScore;

      iterations.push({
        iteration,
        content: currentContent,
        gateResult,
        improvement,
        durationMs: performance.now() - iterationStart,
      });

      // Check if target reached
      if (gateResult.passed) {
        return {
          success: true,
          finalContent: currentContent,
          finalScore: gateResult.score,
          totalIterations: iteration,
          iterations,
          totalDurationMs: performance.now() - startTime,
          stopReason: "target-reached",
        };
      }

      // Check for no improvement (after first iteration)
      if (iteration > 1 && improvement < config.minImprovement) {
        // Check if score degraded
        if (improvement < 0) {
          return {
            success: false,
            finalContent: iterations[iterations.length - 2].content,
            finalScore: previousScore,
            totalIterations: iteration,
            iterations,
            totalDurationMs: performance.now() - startTime,
            stopReason: "score-degraded",
          };
        }

        return {
          success: false,
          finalContent: currentContent,
          finalScore: gateResult.score,
          totalIterations: iteration,
          iterations,
          totalDurationMs: performance.now() - startTime,
          stopReason: "no-improvement",
        };
      }

      previousScore = gateResult.score;

      // Generate improved content
      const feedback = this.buildFeedback(gateResult, config);

      try {
        currentContent = await this.improvementAgent.improve(
          originalRequest,
          currentContent,
          feedback,
          iteration,
        );
      } catch (_error) {
        return {
          success: false,
          finalContent: currentContent,
          finalScore: gateResult.score,
          totalIterations: iteration,
          iterations,
          totalDurationMs: performance.now() - startTime,
          stopReason: GeneralStatus.ERROR,
        };
      }
    }

    // Max iterations reached
    const lastIteration = iterations[iterations.length - 1];
    return {
      success: false,
      finalContent: currentContent,
      finalScore: lastIteration.gateResult.score,
      totalIterations: iterations.length,
      iterations,
      totalDurationMs: performance.now() - startTime,
      stopReason: "max-iterations",
    };
  }

  /**
   * Build feedback string from gate result
   */
  private buildFeedback(gateResult: IGateResult, config: FeedbackLoopConfig): string {
    const parts: string[] = [];

    parts.push(`Current score: ${(gateResult.score * 100).toFixed(1)}%`);
    parts.push(`Target score: ${(config.targetScore * 100).toFixed(1)}%`);
    parts.push("");

    if (gateResult.evaluation) {
      // Add overall feedback
      if (gateResult.evaluation.feedback) {
        parts.push("Feedback:");
        parts.push(gateResult.evaluation.feedback);
        parts.push("");
      }

      // Add criterion-specific feedback
      parts.push("Criterion Scores:");
      for (
        const [name, result] of Object.entries(
          gateResult.evaluation.criteriaScores as Record<string, CriterionResult>,
        )
      ) {
        const status = result.passed ? ICON_SUCCESS : ICON_FAILURE;
        parts.push(
          `  ${status} ${name}: ${(result.score * 100).toFixed(1)}%`,
        );
        if (result.reasoning) {
          parts.push(`      ${result.reasoning}`);
        }
        if (result.issues && result.issues.length > 0) {
          parts.push(`      Issues: ${result.issues.join(", ")}`);
        }
      }
      parts.push("");

      // Add suggestions
      if (
        gateResult.evaluation.suggestions &&
        gateResult.evaluation.suggestions.length > 0
      ) {
        parts.push("Suggestions for improvement:");
        for (const suggestion of gateResult.evaluation.suggestions) {
          parts.push(`  - ${suggestion}`);
        }
      }
    }

    return parts.join("\n");
  }

  /**
   * Resolve criteria from string names or criterion objects
   */
  private resolveCriteria(
    criteriaInput: Array<string | EvaluationCriterion>,
  ): EvaluationCriterion[] {
    const criteria: EvaluationCriterion[] = [];

    for (const item of criteriaInput) {
      if (typeof item === "string") {
        const resolved = getCriteriaByNames([item]);
        criteria.push(...resolved);
      } else {
        criteria.push(item as EvaluationCriterion);
      }
    }

    return criteria;
  }
}

/**
 * Simple improvement agent that formats feedback into a prompt
 */
export class SimpleImprovementAgent implements ImprovementAgent {
  constructor(
    private agentRunner: {
      run(
        identityId: string,
        request: { userPrompt: string; context?: IAgentRequestContext },
      ): Promise<{ content: string }>;
    },
    private improvementAgentId: string,
  ) {}

  async improve(
    originalRequest: string,
    currentContent: string,
    feedback: string,
    iteration: number,
  ): Promise<string> {
    const prompt = `You are improving a response based on evaluation feedback.

Original Request:
${originalRequest}

Current Response (Iteration ${iteration}):
${currentContent}

Evaluation Feedback:
${feedback}

Please provide an improved response that addresses the feedback and improves on the weak areas.
Focus on the criteria that scored lowest.
Maintain the strengths while addressing the weaknesses.

Improved Response:`;

    const result = await this.agentRunner.run(this.improvementAgentId, {
      userPrompt: prompt,
      context: {
        improvementMode: true,
        iteration,
        previousContent: currentContent,
      },
    });

    return result.content;
  }
}

/**
 * Create a feedback loop with default components
 */
export function createFeedbackLoop(
  gateEvaluator: GateEvaluator,
  agentRunner: {
    run(
      identityId: string,
      request: { userPrompt: string; context?: IAgentRequestContext },
    ): Promise<{ content: string }>;
  },
  improvementAgentId: string,
): FeedbackLoop {
  const improvementAgent = new SimpleImprovementAgent(
    agentRunner,
    improvementAgentId,
  );
  return new FeedbackLoop(gateEvaluator, improvementAgent);
}

/**
 * Configuration for self-correcting agent pattern
 */
export interface SelfCorrectingConfig {
  /** Agent to generate initial response */
  generatorAgent: string;
  /** Agent to evaluate responses (can be same as generator) */
  evaluatorAgent: string;
  /** Agent to improve responses (can be same as generator) */
  improverAgent: string;
  /** Evaluation criteria */
  criteria: Array<string | EvaluationCriterion>;
  /** Target score */
  targetScore: number;
  /** Maximum iterations */
  maxIterations: number;
}

/**
 * Run a self-correcting agent pattern
 *
 * This is a convenience function that:
 * 1. Generates initial response
 * 2. Runs feedback loop until target or max iterations
 */
export async function runSelfCorrectingAgent(
  config: SelfCorrectingConfig,
  agentRunner: {
    run(
      identityId: string,
      request: { userPrompt: string; context?: IAgentRequestContext },
    ): Promise<{ content: string }>;
  },
  gateEvaluator: GateEvaluator,
  request: string,
): Promise<FeedbackLoopResult & { initialContent: string }> {
  // Generate initial response
  const initialResponse = await agentRunner.run(config.generatorAgent, {
    userPrompt: request,
    context: {
      selfCorrectingMode: true,
    },
  });

  const initialContent = initialResponse.content;

  // Create feedback loop
  const feedbackLoop = createFeedbackLoop(
    gateEvaluator,
    agentRunner,
    config.improverAgent,
  );

  // Run feedback loop
  const result = await feedbackLoop.run(
    {
      maxIterations: config.maxIterations,
      targetScore: config.targetScore,
      evaluator: config.evaluatorAgent,
      criteria: config.criteria,
      minImprovement: 0.05,
      includePreviousAttempts: true,
    },
    initialContent,
    request,
  );

  return {
    ...result,
    initialContent,
  };
}
