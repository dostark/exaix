/**
 * @module StepHandler
 * @path packages/flow/src/step_handlers/step_handler.ts
 * @description Defines IFlowStepHandler, IStepExecutionContext, and IFlowStepHandlerRegistry —
 * the extension seam for pluggable flow-step type dispatch (Phase 115 Step 3a).
 * @architectural-layer Flows
 * @related-files [packages/flow/src/step_handlers/step_handler_registry.ts, packages/flow/src/flow_runner.ts]
 */

import type { IAgentExecutionResult } from "@exaix/execution";

/**
 * Context passed to a flow step handler's execute() method.
 * Carries the minimal slice of step, request, and flow state the handler needs.
 */
export interface IStepExecutionContext {
  /** The step type string that was dispatched */
  readonly stepType: string;
  // Additional fields (step, request, stepRequest, flow, flowRunId, startedAt, etc.)
  // are added in later sub-steps as handler implementations concretise their needs.
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
