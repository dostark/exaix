/**
 * @module GateEvaluator
 * @path src/flows/gate_evaluator.ts
 * @description Implements quality gates for flow steps, orchestrating judge invocations and pass/fail/retry logic based on criteria.
 * @architectural-layer Flows
 * * @related-files [src/flows/flow_runner.ts, src/flows/evaluation_criteria.ts]
 */

import { z } from "zod";
import {
  calculateWeightedScore,
  checkRequiredCriteria,
  EvaluationCriterion,
  EvaluationCriterionSchema,
  EvaluationResult,
  getCriteriaByNames,
} from "./evaluation_criteria.ts";
import { IStepResult } from "./flow_runner.ts";
import { FlowGateAction, FlowGateOnFail } from "../shared/enums.ts";
import { ICriteriaGeneratorService } from "../shared/interfaces/i_criteria_generator_service.ts";
import { CriteriaGenerator } from "../services/skills/criteria_generator.ts";
import { IRequestAnalysis } from "../shared/schemas/request_analysis.ts";

/**
 * Result of gate evaluation
 */
export interface IGateResult {
  /** Whether the gate passed */
  passed: boolean;
  /** Overall score from evaluation */
  score: number;
  /** Full evaluation result */
  evaluation: EvaluationResult;
  /** Number of attempts made */
  attempts: number;
  /** Action taken based on result */
  action: FlowGateAction;
  /** Duration of evaluation in ms */
  evaluationDurationMs: number;
  /** Any error that occurred */
  error?: string;
}

/**
 * Interface for invoking judge agent
 */
export interface JudgeInvoker {
  evaluate(
    identityId: string,
    content: string,
    criteria: EvaluationCriterion[],
    context?: string,
  ): Promise<EvaluationResult>;
}

/**
 * Gate configuration schema
 */
export const GateConfigSchema = z.object({
  /** Judge identity to use for evaluation */
  identity: z.string(),
  /** Criteria names or objects to evaluate against */
  criteria: z.array(z.union([z.string(), EvaluationCriterionSchema])),
  /** Score threshold for passing (0.0 - 1.0) */
  threshold: z.number().min(0).max(1).default(0.8),
  /** Action to take on gate failure */
  onFail: z.nativeEnum(FlowGateOnFail).default(FlowGateOnFail.HALT),
  /** Maximum retry attempts if onFail is "retry" */
  maxRetries: z.number().int().min(1).default(3),
  /** Include dynamic criteria generated from the request analysis */
  includeRequestCriteria: z.boolean().default(false),
});

export type GateConfig = z.infer<typeof GateConfigSchema>;

/**
 * GateEvaluator class for quality gate evaluation
 */
export class GateEvaluator {
  constructor(
    private judgeInvoker: JudgeInvoker,
    private criteriaGenerator: ICriteriaGeneratorService = new CriteriaGenerator(),
  ) {}

  /**
   * Evaluate a gate step
   *
   * @param config - Gate configuration
   * @param contentToEvaluate - Content to evaluate from previous step
   * @param context - Original request context
   * @param previousAttempts - Number of previous evaluation attempts
   * @param requestAnalysis - Optional analysis used to generate dynamic criteria
   */
  async evaluate(
    config: GateConfig,
    contentToEvaluate: string,
    context?: string,
    previousAttempts: number = 0,
    requestAnalysis?: IRequestAnalysis,
  ): Promise<IGateResult> {
    const startTime = performance.now();

    try {
      // Resolve criteria from names or objects
      const criteria = this.resolveCriteria(config.criteria);

      // Merge dynamic criteria from request analysis when enabled
      let allCriteria = criteria;
      if (config.includeRequestCriteria && requestAnalysis) {
        try {
          const dynamicCriteria = this.criteriaGenerator.fromAnalysis(requestAnalysis);
          const staticNames = new Set(criteria.map((c) => c.name));
          const newDynamic = dynamicCriteria.filter((c) => !staticNames.has(c.name));
          allCriteria = [...criteria, ...newDynamic];
        } catch (error) {
          console.error("[GateEvaluator] Dynamic criteria generation failed, using static only:", error);
        }
      }

      // Invoke judge identity
      const evaluation = await this.judgeInvoker.evaluate(
        config.identity,
        contentToEvaluate,
        allCriteria,
        context,
      );

      // Calculate pass/fail
      const passed = this.checkPassed(evaluation, allCriteria, config.threshold);

      // Determine action
      let action: FlowGateAction;
      if (passed) {
        action = FlowGateAction.PASSED;
      } else if (config.onFail === FlowGateOnFail.RETRY && previousAttempts < config.maxRetries - 1) {
        action = FlowGateAction.RETRY;
      } else if (config.onFail === FlowGateOnFail.CONTINUE_WITH_WARNING) {
        action = FlowGateAction.CONTINUED_WITH_WARNING;
      } else {
        action = FlowGateAction.HALTED;
      }

      return {
        passed,
        score: evaluation.overallScore,
        evaluation,
        attempts: previousAttempts + 1,
        action,
        evaluationDurationMs: performance.now() - startTime,
      };
    } catch (error) {
      return {
        passed: false,
        score: 0,
        evaluation: this.createErrorEvaluation(error),
        attempts: previousAttempts + 1,
        action: config.onFail === FlowGateOnFail.CONTINUE_WITH_WARNING
          ? FlowGateAction.CONTINUED_WITH_WARNING
          : FlowGateAction.HALTED,
        evaluationDurationMs: performance.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Evaluate gate from step result
   */
  evaluateStepResult(
    config: GateConfig,
    stepResult: IStepResult,
    originalRequest?: string,
    previousAttempts: number = 0,
  ): Promise<IGateResult> {
    const content = stepResult.result?.content ?? "";
    return this.evaluate(config, content, originalRequest, previousAttempts);
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
        // Look up by name
        const resolved = getCriteriaByNames([item]);
        criteria.push(...resolved);
      } else {
        // Use as-is (already a criterion object)
        criteria.push(item as EvaluationCriterion);
      }
    }

    return criteria;
  }

  /**
   * Check if evaluation passed based on score and required criteria
   */
  private checkPassed(
    evaluation: EvaluationResult,
    criteria: EvaluationCriterion[],
    threshold: number,
  ): boolean {
    // Check overall score meets threshold
    if (evaluation.overallScore < threshold) {
      return false;
    }

    // Check all required criteria passed
    if (!checkRequiredCriteria(evaluation.criteriaScores, criteria, threshold)) {
      return false;
    }

    return evaluation.pass;
  }

  /**
   * Create an error evaluation result
   */
  private createErrorEvaluation(error: unknown): EvaluationResult {
    return {
      overallScore: 0,
      criteriaScores: {},
      pass: false,
      feedback: `Evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      suggestions: ["Fix the error and retry evaluation"],
      metadata: {
        evaluatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Create feedback message for improvement
   */
  static formatFeedbackForRetry(gateResult: IGateResult): string {
    const { evaluation } = gateResult;

    const failedCriteria = Object.entries(evaluation.criteriaScores)
      .filter(([_, result]) => !result.passed)
      .map(([name, result]) => ({
        name,
        score: result.score,
        issues: result.issues,
        reasoning: result.reasoning,
      }));

    const lines = [
      "## Quality Gate Feedback",
      "",
      `**Overall Score:** ${(evaluation.overallScore * 100).toFixed(1)}%`,
      `**Status:** ${gateResult.passed ? "PASSED" : "FAILED"}`,
      "",
      "### Areas Needing Improvement",
      "",
    ];

    for (const criterion of failedCriteria) {
      lines.push(`#### ${criterion.name} (${(criterion.score * 100).toFixed(1)}%)`);
      lines.push(`*${criterion.reasoning}*`);
      if (criterion.issues.length > 0) {
        lines.push("Issues:");
        for (const issue of criterion.issues) {
          lines.push(`- ${issue}`);
        }
      }
      lines.push("");
    }

    if (evaluation.suggestions.length > 0) {
      lines.push("### Suggestions");
      for (const suggestion of evaluation.suggestions) {
        lines.push(`- ${suggestion}`);
      }
    }

    return lines.join("\n");
  }
}

/**
 * Mock judge invoker for testing
 */
export class MockJudgeInvoker implements JudgeInvoker {
  private mockResults: Map<string, EvaluationResult> = new Map();
  private defaultScore: number = 0.85;

  setMockResult(identityId: string, result: EvaluationResult): void {
    this.mockResults.set(identityId, result);
  }

  setDefaultScore(score: number): void {
    this.defaultScore = score;
  }

  evaluate(
    identityId: string,
    _content: string,
    criteria: EvaluationCriterion[],
    _context?: string,
  ): Promise<EvaluationResult> {
    // Check for specific mock result
    const mockResult = this.mockResults.get(identityId);
    if (mockResult) {
      return Promise.resolve(mockResult);
    }

    // Generate default result
    const criteriaScores: EvaluationResult["criteriaScores"] = {};
    for (const criterion of criteria) {
      criteriaScores[criterion.name] = {
        name: criterion.name,
        score: this.defaultScore,
        reasoning: "Mock evaluation",
        issues: [],
        passed: this.defaultScore >= 0.7,
      };
    }

    return Promise.resolve({
      overallScore: calculateWeightedScore(criteriaScores, criteria),
      criteriaScores,
      pass: this.defaultScore >= 0.7,
      feedback: "Mock evaluation completed",
      suggestions: [],
      metadata: {
        evaluatedAt: new Date().toISOString(),
        evaluatorAgent: identityId,
      },
    });
  }
}
