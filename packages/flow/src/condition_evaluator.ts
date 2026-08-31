/**
 * @module ConditionEvaluator
 * @path packages/flow/src/condition_evaluator.ts
 * @description Evaluates dynamic step conditions using safe JavaScript execution against a context of previous results and request metadata.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/flow_runner.ts, "packages/schemas/src/flow.ts"]
 */

import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import type { IStepResult } from "./flow_runner.ts";
import type { JSONValue } from "@exaix/core";
import { evaluateExpression, type ExpressionContext, validateExpression } from "./safe_expression.ts";
import type { Opt, Reason } from "@exaix/core/types";

/**
 * Context available during condition evaluation
 */
export interface IConditionContext {
  /** Results from previously executed steps, keyed by step id for direct access. */
  results: Record<string, IStepResultContext>;
  /** The same results as an array, so aggregate conditions are expressible: the sandbox
   *  permits array methods only on real arrays and doesn't allowlist `Object.values`, so
   *  "all previous steps succeeded" could not be expressed via `results` alone. */
  steps: (IStepResultContext & { id: string })[];
  /** Original flow request */
  request: {
    userPrompt: string;
    traceId?: string;
    requestId?: string;
  };
  /** Flow definition metadata */
  flow: {
    id: string;
    name: string;
    version: string;
  };
}

/**
 * Step result context for condition evaluation
 */
export interface IStepResultContext {
  /** Whether the step succeeded */
  success: boolean;
  /** Whether the step was skipped due to condition */
  skipped?: boolean;
  /** Step output content */
  content?: string;
  /** Parsed JSON output if applicable */
  data?: JSONValue;
  /** Step execution duration in ms */
  duration: number;
  /** Error message if step failed */
  error?: string;
}

/**
 * Result of condition evaluation
 */
export interface IConditionResult {
  /** Whether condition evaluated to true */
  shouldExecute: boolean;
  /** Original condition expression */
  condition: string;
  /** Any error during evaluation */
  error?: string;
  /** Evaluation duration in ms */
  evaluationTimeMs: number;
}

/**
 * Error thrown when condition evaluation fails
 */
export class ConditionEvaluationError extends Error {
  constructor(
    message: string,
    public readonly condition: string,
    public readonly stepId: string,
  ) {
    super(message);
    this.name = "ConditionEvaluationError";
  }
}

/**
 * ConditionEvaluator class for evaluating step conditions
 */
export class ConditionEvaluator {
  evaluate(condition: string, context: IConditionContext): IConditionResult {
    const startTime = performance.now();

    // Empty or whitespace-only conditions default to true
    if (!condition || condition.trim() === "") {
      return {
        shouldExecute: true,
        condition,
        evaluationTimeMs: performance.now() - startTime,
      };
    }

    try {
      // Create a safe evaluation function
      const result = this.safeEvaluate(condition, context);

      return {
        shouldExecute: result,
        condition,
        evaluationTimeMs: performance.now() - startTime,
      };
    } catch (error) {
      return {
        shouldExecute: false,
        condition,
        error: error instanceof Error ? error.message : String(error),
        evaluationTimeMs: performance.now() - startTime,
      };
    }
  }

  evaluateStepCondition(
    step: IFlowStep,
    stepResults: Map<string, IStepResult>,
    request: { userPrompt: string; traceId?: string; requestId?: string },
    flow: IFlow,
  ): IConditionResult {
    // No condition means always execute
    if (!step.condition) {
      return {
        shouldExecute: true,
        condition: "",
        evaluationTimeMs: 0,
      };
    }

    const context = this.buildContext(stepResults, request, flow);
    return this.evaluate(step.condition, context);
  }

  /**
   * Build evaluation context from step results
   */
  buildContext(
    stepResults: Map<string, IStepResult>,
    request: { userPrompt: string; traceId?: string; requestId?: string },
    flow: IFlow,
  ): IConditionContext {
    const results: Record<string, IStepResultContext> = {};

    for (const [stepId, result] of stepResults) {
      results[stepId] = {
        success: result.success,
        skipped: (result as IStepResult & { skipped?: boolean }).skipped,
        content: result.result?.content,
        data: this.tryParseJson(result.result?.content),
        duration: result.duration,
        error: result.error,
      };
    }

    return {
      results,
      steps: Object.entries(results).map(([id, result]) => ({ id, ...result })),
      request: {
        userPrompt: request.userPrompt,
        traceId: request.traceId,
        requestId: request.requestId,
      },
      flow: {
        id: flow.id,
        name: flow.name,
        version: flow.version,
      },
    };
  }

  /** Conditions are treated as DATA: parsed against a restricted boolean-expression
   *  grammar and evaluated against an allowlisted context — never host globals, arbitrary
   *  function calls, assignments, or side effects. */
  private safeEvaluate(condition: string, context: IConditionContext): boolean {
    // Project the context to a plain JSON structure: conditions only ever read
    // JSON-shaped step data, and this yields an ExpressionContext without casts.
    const jsonContext: ExpressionContext = JSON.parse(
      JSON.stringify({ results: context.results, steps: context.steps, request: context.request, flow: context.flow }),
    );
    return evaluateExpression(condition, jsonContext);
  }

  /**
   * Try to parse content as JSON, return undefined if not valid JSON
   */
  private tryParseJson(content?: Opt<string, Reason.OptionalInput>): JSONValue | undefined {
    if (!content) return undefined;

    try {
      return JSON.parse(content) as JSONValue;
    } catch {
      return undefined;
    }
  }

  validateCondition(condition: string): { valid: boolean; error?: string } {
    if (!condition || condition.trim() === "") {
      return { valid: true };
    }

    // Statically parse + validate the condition without evaluating it.
    return validateExpression(condition);
  }
}
