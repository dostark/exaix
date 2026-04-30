/**
 * @module ConditionEvaluator
 * @path src/flows/condition_evaluator.ts
 * @description Evaluates dynamic step conditions using safe JavaScript execution against a context of previous results and request metadata.
 * @architectural-layer Flows
 * @related-files [src/flows/flow_runner.ts, "packages/schemas/src/flow.ts"]
 */

import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import { FlowInputSource, RequestKind } from "@exaix/core";
import type { IStepResult } from "./flow_runner.ts";
import type { JSONValue } from "@exaix/core";

/**
 * Context available during condition evaluation
 */
export interface IConditionContext {
  /** Results from previously executed steps */
  results: Record<string, IStepResultContext>;
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
export interface ConditionResult {
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
  /**
   * Evaluate a condition expression
   *
   * @param condition - JavaScript expression to evaluate
   * @param context - Context containing results, request, and flow info
   * @returns ConditionResult with shouldExecute boolean
   */
  evaluate(condition: string, context: IConditionContext): ConditionResult {
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

  /**
   * Evaluate a condition for a specific step
   *
   * @param step - IFlow step with optional condition
   * @param stepResults - Map of completed step results
   * @param request - Original flow request
   * @param flow - IFlow definition
   * @returns ConditionResult
   */
  evaluateStepCondition(
    step: IFlowStep,
    stepResults: Map<string, IStepResult>,
    request: { userPrompt: string; traceId?: string; requestId?: string },
    flow: IFlow,
  ): ConditionResult {
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

  /**
   * Safely evaluate a condition expression
   * Uses Function constructor with restricted context
   */
  private safeEvaluate(condition: string, context: IConditionContext): boolean {
    // Create a function that has access to context variables
    // This is safer than eval() as it creates a new scope
    const fn = new Function(
      "results",
      FlowInputSource.REQUEST,
      RequestKind.FLOW,
      `"use strict"; return (${condition});`,
    );

    return Boolean(fn(context.results, context.request, context.flow));
  }

  /**
   * Try to parse content as JSON, return undefined if not valid JSON
   */
  private tryParseJson(content?: string): JSONValue | undefined {
    if (!content) return undefined;

    try {
      return JSON.parse(content) as JSONValue;
    } catch {
      return undefined;
    }
  }

  /**
   * Validate a condition expression without executing it
   * Returns any syntax errors found
   */
  validateCondition(condition: string): { valid: boolean; error?: string } {
    if (!condition || condition.trim() === "") {
      return { valid: true };
    }

    try {
      // Try to parse the condition as a function body
      new Function("results", FlowInputSource.REQUEST, RequestKind.FLOW, `"use strict"; return (${condition});`);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Singleton instance for convenience
 */
export const conditionEvaluator = new ConditionEvaluator();
