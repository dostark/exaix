/**
 * @module IGateEvaluator
 * @path packages/core/src/types/i_gate_evaluator.ts
 * @description Interface for Flow Gate Evaluation service.
 * @architectural-layer Shared/Interfaces
 * @related-files [packages/flow/src/gate_evaluator.ts, packages/core/src/evaluation/evaluation_criteria.ts, packages/core/src/types/i_application_context.ts]
 */

import type { EvaluationCriterion, EvaluationResult } from "@exaix/core/types";

import type { IBindingGateContext, IRequestAnalysis } from "@exaix/schemas";

import type { FlowGateAction, FlowGateOnFail } from "@exaix/core";

/** Structural metadata keeps core independent of the AI provider package. */
export interface IFlowJudgeCallMetadata {
  traceId?: string;
  callSite?: { scenarioId: string; stepId: string; flowStepId?: string; callIndex: number };
}

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
  /** Judge agent role to use for evaluation */
  agentRole: string;
  /** Criteria names or objects to evaluate against */
  criteria: Array<string | EvaluationCriterion>;
  /** Score threshold for passing (0.0 - 1.0) */
  threshold: number;
  /** Action to take on gate failure */
  onFail: FlowGateOnFail;
  /** Maximum retry attempts if onFail is "retry" */
  maxRetries: number;
  /** Immutable evaluation ceiling captured at flow admission. */
  evaluationCeiling?: number;
  /** Include dynamic criteria generated from the request analysis */
  includeRequestCriteria: boolean;
  /** Flow-gate judge binding carried on the evaluation. Non-flow callers omit it and
   *  the judge runner keeps the boot provider. */
  bindingContext?: IBindingGateContext;
  callMetadata?: IFlowJudgeCallMetadata;
}

/**
 * Interface for invoking judge agent
 */
export interface IJudgeInvoker {
  evaluate(
    agentRole: string,
    content: string,
    criteria: EvaluationCriterion[],
    context?: string,
    bindingContext?: IBindingGateContext,
    callMetadata?: IFlowJudgeCallMetadata,
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
