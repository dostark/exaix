/**
 * @module IGateEvaluator
 * @path src/shared/interfaces/i_gate_evaluator.ts
 * @description Interface for Flow Gate Evaluation service.
 * @architectural-layer Shared/Interfaces
 * @related-files [src/flows/gate_evaluator.ts, src/flows/evaluation_criteria.ts, src/shared/interfaces/i_application_context.ts]
 */

import type { EvaluationCriterion, EvaluationResult } from "../../flows/evaluation_criteria.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { FlowGateAction, FlowGateOnFail } from "@exaix/core";

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
 * Gate configuration
 */
export interface IGateConfig {
  /** Judge identity to use for evaluation */
  identity: string;
  /** Criteria names or objects to evaluate against */
  criteria: Array<string | EvaluationCriterion>;
  /** Score threshold for passing (0.0 - 1.0) */
  threshold: number;
  /** Action to take on gate failure */
  onFail: FlowGateOnFail;
  /** Maximum retry attempts if onFail is "retry" */
  maxRetries: number;
  /** Include dynamic criteria generated from the request analysis */
  includeRequestCriteria: boolean;
}

/**
 * Interface for invoking judge agent
 */
export interface IJudgeInvoker {
  evaluate(
    identityId: string,
    content: string,
    criteria: EvaluationCriterion[],
    context?: string,
  ): Promise<EvaluationResult>;
}

/**
 * Interface for quality gate evaluation
 */
export interface IGateEvaluator {
  evaluate(
    config: IGateConfig,
    contentToEvaluate: string,
    context?: string,
    previousAttempts?: number,
    requestAnalysis?: IRequestAnalysis,
  ): Promise<IGateResult>;
}
