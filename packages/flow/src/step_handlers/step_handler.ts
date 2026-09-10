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
import type { JSONValue } from "@exaix/core";

/** Context passed to a flow step handler's execute() — carries the step, request, flow state, and runtime services it needs. */
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
    /** The flow's portal alias; required by a session_delegate_cycle step to resolve its portal config. */
    readonly portal?: string;
    /** The portal's configured `target_path` verbatim; resolved to a real per-trace
     *  worktree downstream by `SessionDelegationCoordinator.prepareBrief`. Required by a
     *  session_delegate_cycle step. */
    readonly executionRoot?: string;
    /** Worktree-relative `.exa/PlanContext/<slug>.md` pointer; required by a session_delegate_cycle step. */
    readonly planContextRef?: string;
  };

  /** The prepared step request */
  readonly stepRequest: {
    readonly userPrompt: string;
    readonly context: Record<string, JSONValue>;
    readonly traceId?: string;
    readonly requestId?: string;
    readonly scenarioId?: string;
    readonly stepId?: string;
    readonly flowStepId?: string;
    readonly requestAnalysis?: IRequestAnalysis;
    readonly skills?: readonly string[];
    readonly sharedNamespace?: Readonly<Record<string, string>>;
    readonly parallelGroupResults?: Readonly<
      Record<
        string,
        {
          readonly groupId: string;
          readonly mergedOutput: string;
          readonly memberCount: number;
          readonly successCount: number;
          readonly completedAt: string;
        }
      >
    >;
    /** The flow's portal alias; required for a strategy-routed step. */
    readonly portal?: string;
    /** True for the flow's terminal `output.format: json` step (`flow_runner.isFinalJsonStrategyStep`);
     *  tells a strategy-routed executor to coerce untagged output into parseable Plan JSON. */
    readonly expectPlanJsonOutput?: boolean;
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

/** A pluggable handler for one or more flow-step types, registered into IFlowStepHandlerRegistry keyed by stepType string. */
export interface IFlowStepHandler {
  /** The step type this handler claims (e.g. "agent", "gate", "voting_group"). */
  readonly stepType: string;

  /** Execute the step; returns an IAgentExecutionResult (thought, content, raw). */
  execute(ctx: IStepExecutionContext): Promise<IAgentExecutionResult>;
}

/** Registry for IFlowStepHandler instances, keyed by step type string — paid step types register here instead of modifying core's if-chain. */
export interface IFlowStepHandlerRegistry {
  /** Register a handler for its declared stepType. Overwrites any existing handler for that key. */
  register(handler: IFlowStepHandler): void;

  /** Register a handler under a specific key, overriding its stepType — useful for aliasing (e.g. AgentStepHandler for BRANCH and CONSENSUS). */
  registerWithKey(key: string, handler: IFlowStepHandler): void;

  /** Retrieve a handler by step type string. Returns undefined if not registered. */
  get(stepType: string): IFlowStepHandler | undefined;

  /** Check whether a handler is registered for the given step type. */
  has(stepType: string): boolean;

  /** Return all registered step-type keys. */
  keys(): string[];
}
