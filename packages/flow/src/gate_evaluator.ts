/**
 * @module GateEvaluator
 * @path packages/flow/src/gate_evaluator.ts
 * @description Implements quality gates for flow steps, orchestrating judge invocations and pass/fail/retry logic based on criteria.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/flow_runner.ts, packages/core/src/evaluation/mod.ts]
 */

import { z } from "zod";
import {
  calculateWeightedScore,
  checkRequiredCriteria,
  type EvaluationCriterion,
  EvaluationCriterionSchema,
  type EvaluationResult,
  getCriteriaByNames,
} from "@exaix/core/evaluation";
import type { IStepResult } from "./flow_runner.ts";
import { FlowGateAction, FlowGateOnFail } from "@exaix/core";
import type {
  ICriteriaGeneratorService,
  IGateConfig,
  IGateEvaluator,
  IGateResult,
  IJudgeInvoker,
} from "@exaix/core/types";
import { CriteriaGenerator } from "@exaix/core/skills";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { Opt, Reason } from "@exaix/core/types";
/**
 * Gate configuration schema
 */
export const GateConfigSchema = z.object({
  /** Judge identity to use for evaluation */
  agent_role: z.string(),
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
export class GateEvaluator implements IGateEvaluator {
  constructor(
    private judgeInvoker: IJudgeInvoker,
    private criteriaGenerator: ICriteriaGeneratorService = new CriteriaGenerator(),
  ) {}

  async evaluate(
    config: IGateConfig,
    contentToEvaluate: string,
    context?: Opt<string, Reason.OptionalContext>,
    previousAttempts: number = 0,
    requestAnalysis?: Opt<IRequestAnalysis, Reason.OptionalInput>,
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
    originalRequest?: Opt<string, Reason.OptionalInput>,
    previousAttempts: Opt<number, Reason.SensibleDefault> = 0,
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
  private createErrorEvaluation(error: Error | string | unknown): EvaluationResult {
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
export class MockJudgeInvoker implements IJudgeInvoker {
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
    _context?: Opt<string, Reason.AbstractBoundary>,
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
