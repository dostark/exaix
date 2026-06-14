/**
 * @module StepHandler
 * @path packages/flow/src/step_handlers/step_handler.ts
 * @description Defines IFlowStepHandler, IStepExecutionContext, and IFlowStepHandlerRegistry —
 * the extension seam for pluggable flow-step type dispatch (Phase 115 Step 3a).
 * @architectural-layer Flows
 * @related-files [packages/flow/src/step_handlers/step_handler_registry.ts, packages/flow/src/flow_runner.ts]
 */

import type { IFlowStep } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";

/**
 * Context passed to a flow step handler's execute() method.
 * Carries the step, request, flow state, and runtime services the handler needs.
 */
export interface IStepExecutionContext {
  /** The step type string that was dispatched */
  readonly stepType: string;

  /** The flow step being executed */
  readonly step: IFlowStep;

  /** The flow being executed */
  readonly flow: { readonly id: string; readonly settings?: { readonly includeRequestCriteria?: boolean } };

  /** The original request */
  readonly request: {
    readonly userPrompt: string;
    readonly traceId?: string;
    readonly requestId?: string;
    readonly requestAnalysis?: IRequestAnalysis;
  };

  /** The prepared step request */
  readonly stepRequest: {
    readonly userPrompt: string;
    readonly requestAnalysis?: IRequestAnalysis;
  };

  /** Unique identifier for this flow run */
  readonly flowRunId: string;

  /** When the step execution started */
  readonly startedAt: Date;

  /** Base event-log info derived from flow + request (filled by FlowRunner before dispatch) */
  readonly flowLogBase: {
    readonly flowId: string;
    readonly traceId?: string;
    readonly requestId?: string;
  };
}

/**
 * A pluggable handler for one or more flow-step types.
 * Registered into IFlowStepHandlerRegistry keyed by stepType string.
 */
export interface IFlowStepHandler {
  /** The step type this handler claims (e.g. "agent", "gate", "voting_group"). */
  readonly stepType: string;

  /**
   * Execute the step.
   * Returns an IAgentExecutionResult with thought, content, and raw fields.
   */
  execute(ctx: IStepExecutionContext): Promise<IAgentExecutionResult>;
}

/**
 * Registry for IFlowStepHandler instances, keyed by step type string.
 * Paid step types register here instead of modifying core's if-chain.
 */
export interface IFlowStepHandlerRegistry {
  /** Register a handler for its declared stepType. Overwrites any existing handler for that key. */
  register(handler: IFlowStepHandler): void;

  /** Retrieve a handler by step type string. Returns undefined if not registered. */
  get(stepType: string): IFlowStepHandler | undefined;

  /** Check whether a handler is registered for the given step type. */
  has(stepType: string): boolean;
}
