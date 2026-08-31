/**
 * @module FlowRunner
 * @path packages/flow/src/flow_runner.ts
 * @description Core orchestrator for multi-agent flow execution.
 * @architectural-layer Flows
 * @related-files [packages/flow/mod.ts, packages/request/src/router.ts]
 */

import type {
  IFlow,
  IFlowNamespaceWrite,
  IFlowStep,
  IGateEvaluate,
  ISessionDelegateCycleRejectionReason,
} from "@exaix/schemas/flow.ts";
import { encodeHex } from "@std/encoding/hex";
import { FlowRuntimeValidator } from "./flow_runtime_validator.ts";
import { ParallelGroupMergeService } from "./parallel_group_merge_service.ts";
import { RetryBudgetService } from "./retry_budget_service.ts";
import { CompensationService } from "./compensation_service.ts";
import { WaveOrchestrator } from "./wave_orchestrator.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import { ConditionEvaluator } from "./condition_evaluator.ts";
import type { JSONValue } from "@exaix/core";
import type { IDatabaseService } from "@exaix/storage-sqlite";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import { createGitServiceStub, createProviderStub } from "@exaix/testing/helpers/stub_factories.ts";
import {
  FlowInputSource,
  FlowStepExecutionMode,
  FlowStepOnErrorAction,
  FlowStepType,
  StepAttemptClass,
  StepExecutionDisposition,
  StepSideEffectClass,
} from "@exaix/core";
import { DynamicStepExecutor } from "./dynamic_step_executor.ts";
import { ActivityJournal } from "./activity_journal.ts";
import { buildConfirmationInterceptor } from "@exaix/tool-runtime";
import type { IMcpClient } from "@exaix/mcp";
import type { IToolManifestResolver } from "@exaix/core/types";
import { LlmClient } from "@exaix/ai/llm_client.ts";
import type { ModelResolver } from "@exaix/ai";
import type { IModelIntent } from "@exaix/schemas";
import { mapPresetToSize } from "./preset_mapper.ts";
import type { ToolHandler } from "@exaix/mcp/server";
import type { McpToolName } from "@exaix/mcp";
import type { Config } from "@exaix/schemas/config.ts";
import type {
  IApplicationContext,
  IGateConfig,
  IGateEvaluator,
  IHitlPolicyEvaluator,
  IToolConfirmationInterceptor,
} from "@exaix/core/types";
import { FlowStepHandlerRegistry } from "./step_handlers/step_handler_registry.ts";
import { GateStepHandler, type IPendingWaitStateRef } from "./step_handlers/gate_step_handler.ts";
import { AgentStepHandler } from "./step_handlers/agent_step_handler.ts";
import { SessionDelegateCycleStepHandler } from "./step_handlers/session_delegate_cycle_step_handler.ts";
import { UnknownFlowStepError } from "./step_handlers/flow_step_error.ts";
import type { IStepExecutionContext } from "./step_handlers/step_handler.ts";
import { type IFlowTraceStore, isUuid } from "./flow_trace_store.ts";
import type { IPlanContextResolver } from "./plan_context_resolver.ts";
import type { ISessionDelegationCoordinator } from "@exaix/session/session_delegation.ts";
import {
  createInMemorySessionDelegateCycleClaimStore,
  type ISessionDelegateCycleClaimStore,
} from "@exaix/session/session_delegate_cycle_claim_store.ts";
import {
  createInMemorySessionDelegateCycleStore,
  type ISessionDelegateCycleStore,
} from "@exaix/session/session_delegate_cycle_store.ts";
import {
  FlowCheckpointService,
  FlowNamespaceService,
  type IFlowCheckpointService,
  type IFlowNamespaceService,
} from "@exaix/flow";
import { FlowCheckpointCoordinator } from "./flow_checkpoint_coordinator.ts";
import { StepOutputFormatter } from "./step_output_formatter.ts";
import { FlowNamespaceCoordinator } from "./flow_namespace_coordinator.ts";
import type { IMilestoneEmitter } from "@exaix/core/observability";
import type { IExecutionMilestone } from "@exaix/schemas";
import { DomainEventType, type IEventRegistry } from "@exaix/core/events";
import {
  DEFAULT_COST_PRECISION_FACTOR,
  DEFAULT_FLOW_STEP_BACKOFF_MS,
  DEFAULT_UNKNOWN_ERROR_MESSAGE,
  DEFAULT_UNKNOWN_LABEL,
  FLOW_EVENT_COMPLETED,
  FLOW_EVENT_STEP_FALLBACK,
  FLOW_EVENT_STEP_RETRY,
  FLOW_EVENT_STEP_SKIPPED,
  FLOW_EVENT_STEP_SKIPPED_BY_REUSE,
  FLOW_EVENT_VALIDATION_FAILED,
  MILESTONE_FLOW_COMPLETED,
  MILESTONE_FLOW_FAILED,
  MILESTONE_FLOW_STEP_COMPLETED,
  MILESTONE_FLOW_STEP_REPLAYED,
  MILESTONE_FLOW_STEP_SKIPPED,
  MILESTONE_FLOW_STEP_STARTED,
} from "@exaix/core";
import type { IStepDurabilityStore, IStepExecutionRecord, IStepReplayPolicy } from "./contracts/step_durability.ts";
import { DefaultStepReplayPolicy } from "./contracts/step_durability.ts";
import type { IWaitStateService } from "./wait_states/wait_state_service.ts";
import type { Opt, Reason } from "@exaix/core/types";

/**
 * Interface for agent executors (IAgentRunner or similar)
 */
export interface IAgentExecutor {
  run(identityId: string, request: IFlowStepRequest): Promise<IAgentExecutionResult>;
  /** Optional blueprint-existence probe; absent executors (e.g. test doubles) skip the identity check. */
  hasBlueprint?(identityId: string): Promise<boolean>;
  /** Strategy-routed step execution: forces `identityId` through the agent strategy registry,
   * bypassing `run()`'s single generate call. Absent executors fail fast rather than falling back. */
  runWithStrategy?(
    identityId: string,
    request: IFlowStepRequest,
    strategy: NonNullable<IFlowStep["strategy"]>,
  ): Promise<IAgentExecutionResult>;
}

/**
 * Interface for the flow runner service
 */
export interface IFlowRunner {
  execute(
    flow: IFlow,
    request: {
      userPrompt: string;
      traceId?: string;
      requestId?: string;
      requestAnalysis?: IRequestAnalysis;
      portalKnowledge?: IPortalKnowledge;
      portal?: string;
      scenarioId?: string;
      stepId?: string;
      executionRoot?: string;
      planContextRef?: string;
    },
  ): Promise<IFlowResult>;
}

/**
 * Request details for a single step execution
 */
export interface IFlowStepRequest {
  userPrompt: string;
  context: Record<string, JSONValue>;
  traceId?: string;
  requestId?: string;
  /** Call-site key: the scenario/step that submitted the request, so LLM calls can be addressed by call site instead of prompt hash. */
  scenarioId?: string;
  stepId?: string;
  /** This flow-internal step's own id, e.g. "define-endpoints". Scopes call-index assignment per
   *  flow step so steps racing in the same parallel wave (WaveOrchestrator.executeWave uses
   *  Promise.all) cannot collide on the same index. */
  flowStepId?: string;
  /** Skills to apply for this step execution */
  skills?: string[];
  /** Structured request analysis. */
  requestAnalysis?: IRequestAnalysis;
  /** Resolved namespace reads for this step, keyed by binding key. */
  sharedNamespace?: Record<string, string>;
  /** Deterministic summaries for requested parallel groups. */
  parallelGroupResults?: Record<string, IParallelGroupSummary>;
  /** The flow's portal alias, threaded unchanged from `FlowRunner.execute()`'s `request.portal`.
   *  Required by a strategy-routed step to resolve `AgentOrchestrator.executeStep`'s mandatory
   *  `options.portal`; absent is fine for a no-strategy step (`AgentRunner.run` never needs one). */
  portal?: string;
}

export interface IParallelGroupSummary {
  groupId: string;
  mergedOutput: string;
  memberCount: number;
  successCount: number;
  completedAt: string;
}

/**
 * Configuration for FlowRunner
 */
export interface IFlowRunnerConfig {
  agentExecutor: IAgentExecutor;
  eventLogger: IFlowEventLogger;
  eventRegistry?: IEventRegistry;
  milestoneEmitter?: IMilestoneEmitter;
  context?: IApplicationContext;
  db?: IDatabaseService;
  gateEvaluator?: IGateEvaluator;
  config?: Config;
  /** Canonical dynamic handler map from buildDynamicHandlers(context, permissions); takes
   *  precedence over mcpHandlers and ensures only manifest-approved tools reach DynamicStepExecutor. */
  dynamicHandlers?: Map<McpToolName, ToolHandler>;
  /** @deprecated Use dynamicHandlers with buildDynamicHandlers() output instead. */
  mcpHandlers?: ToolHandler[];
  /** Optional step durability store for persisting execution records. No-op when omitted. */
  stepDurabilityStore?: IStepDurabilityStore;
  /** Optional replay policy for deciding whether a prior step result can be reused. No-op (deny all) when omitted. */
  stepReplayPolicy?: IStepReplayPolicy;
  /** Optional checkpoint service override for testing; takes precedence over config-derived service. */
  checkpointService?: IFlowCheckpointService;
  /** Optional wait-state service for durable approval/pause gates. No-op when omitted. */
  waitStateService?: IWaitStateService;
  /** Model preset name for dynamic steps (e.g. "small", "medium", "large"); LlmClient defaults to "default" (models.default) when omitted. */
  dynamicModel?: string;
  /** Optional ModelResolver for resolving dynamicModel presets to provider:model. */
  modelResolver?: ModelResolver;
  /** Optional HITL policy evaluator for per-action governance. No-op (Solo) when omitted. */
  hitlPolicyEvaluator?: IHitlPolicyEvaluator;
  /** Dynamic-mode tool sets from the MCP manifest. Required for dynamic step execution. */
  dynamicModeTools?: ReadonlySet<string>;
  dynamicModeApprovalTools?: ReadonlySet<string>;
  /** Pre-built MCP client for dynamic step execution. Overrides dynamicHandlers/mcpHandlers when provided. */
  mcpClient?: IMcpClient & IToolManifestResolver;
  /** Pre-built confirmation interceptor for dynamic step execution. Created internally when omitted. */
  confirmationInterceptor?: IToolConfirmationInterceptor;
  /** Durable per-request parent trace store. Required for a flow with a session_delegate_cycle step whose request omits `traceId`; unused otherwise. */
  flowTraceStore?: IFlowTraceStore;
  /** Daemon-owned session-delegation coordinator. Registers SessionDelegateCycleStepHandler when present. */
  sessionDelegationCoordinator?: ISessionDelegationCoordinator;
  /** Resolves a request's plan_context_ref beneath its executionRoot. Required alongside sessionDelegationCoordinator. */
  planContextResolver?: IPlanContextResolver;
  /** SQLite launch source of truth for session_delegate_cycle claims. Falls back to a process-local
   *  in-memory store (correct within one process, not crash-durable) when omitted, so existing
   *  sessionDelegationCoordinator wiring keeps working without also supplying this. */
  sessionDelegateCycleClaimStore?: ISessionDelegateCycleClaimStore;
  /** Atomic JSON checkpoint store for session_delegate_cycle resume. Falls back to a process-local in-memory store (not crash-durable) when omitted. */
  sessionDelegateCycleStore?: ISessionDelegateCycleStore;
}

/**
 * Result of executing a single flow step
 */
export interface IStepResult {
  /** Step ID */
  stepId: string;
  /** Whether the step succeeded */
  success: boolean;
  /** Whether the step was skipped due to condition */
  skipped?: boolean;
  /** The condition that caused skipping (if skipped) */
  skipReason?: string;
  /** Execution result if successful */
  result?: IAgentExecutionResult;
  /** Error message if failed */
  error?: string;
  /** Execution duration in milliseconds */
  duration: number;
  /** When the step started */
  startedAt: Date;
  /** When the step completed */
  completedAt: Date;
  /** Zero-based wave number used for deterministic compensation ordering. */
  waveIndex?: number;
  /** True when the logical step eventually succeeded after retry recovery. */
  wasRetried?: boolean;
  /** Number of retry recovery attempts consumed before success. */
  retryCount?: number;
  /** True when the logical step succeeded via a fallback step. */
  fallbackUsed?: boolean;
  /** True when compensation actions were executed for this completed step. */
  compensationRan?: boolean;
  /** Deferred namespace writes flushed after the wave settles. */
  namespaceWrites?: IStepNamespaceWrites;
  /** When set, the step created a durable wait state that must be resolved before the flow can continue. */
  waitStateId?: string;
}

interface IStepNamespaceWrites {
  writes: IFlowNamespaceWrite[];
  stepOutput: string;
}

/** The original flow-execution request, threaded unchanged from `FlowRunner.execute()` through
 *  every internal step method. `portal` is carried here so a strategy-routed step can resolve
 *  a portal alias for `AgentOrchestrator.executeStep`. */
type IFlowOriginalRequest = {
  userPrompt: string;
  traceId?: string;
  requestId?: string;
  requestAnalysis?: IRequestAnalysis;
  portal?: string;
  /** Portal-configured worktree root; required by a session_delegate_cycle step. */
  executionRoot?: string;
  /** Worktree-relative `.exa/PlanContext/<slug>.md` pointer; required by a session_delegate_cycle step. */
  planContextRef?: string;
};

/** Shared context for step-level execution (reduces parameter count across step methods). */
interface IStepContext {
  flowRunId: string;
  step: IFlowStep;
  flow: IFlow;
  request: IFlowOriginalRequest;
  stepResults: Map<string, IStepResult>;
  startedAt: Date;
}

type IFormatStepSuccessContext = Pick<IStepContext, "flowRunId" | "step" | "request" | "startedAt">;

interface IStepRecoveryMetadata {
  wasRetried?: boolean;
  retryCount?: number;
  fallbackUsed?: boolean;
  compensationRan?: boolean;
}

interface IFlowEventRequestContext {
  traceId?: string;
  requestId?: string;
}

export interface IFlowEventLogBase extends IFlowEventRequestContext {
  flowId: string;
}

interface IFlowProviderTokenStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface IFlowWaveErrorPayload {
  stepId: string;
  error: string;
}

export interface IFlowEventPayloadMap {
  [DomainEventType.FlowValidating]: IFlowEventLogBase & { stepCount: number };
  "flow.validation.failed": IFlowEventLogBase & { error: string };
  [DomainEventType.FlowValidated]: IFlowEventLogBase & { stepCount: number; maxParallelism: number; failFast: boolean };
  [DomainEventType.FlowStarted]: IFlowEventLogBase & {
    flowRunId: string;
    stepCount: number;
    maxParallelism: number;
    failFast: boolean;
  };
  [DomainEventType.FlowDependenciesResolving]: IFlowEventLogBase & { flowRunId: string };
  [DomainEventType.FlowDependenciesResolved]: IFlowEventLogBase & {
    flowRunId: string;
    waveCount: number;
    totalSteps: number;
  };
  [DomainEventType.FlowWaveStarted]: IFlowEventRequestContext & {
    flowRunId: string;
    waveNumber: number;
    waveSize: number;
    stepIds: string[];
  };
  [DomainEventType.FlowWaveResumeSkipped]: IFlowEventRequestContext & {
    flowRunId: string;
    waveNumber: number;
    skippedStepIds: string[];
  };
  [DomainEventType.FlowWaveCompleted]: IFlowEventRequestContext & {
    flowRunId: string;
    waveNumber: number;
    waveSize: number;
    successCount: number;
    failureCount: number;
    failed: boolean;
  };
  "flow.parallel_group.started": IFlowEventRequestContext & {
    flowRunId: string;
    waveNumber: number;
    groupId: string;
    stepIds: string[];
    startedAt: number;
    isoStartedAt: string;
  };
  "flow.parallel_group.completed": IFlowEventRequestContext & {
    flowRunId: string;
    waveNumber: number;
    groupId: string;
    stepIds: string[];
    successCount: number;
    failureCount: number;
    failed: boolean;
    duration: number;
  };
  "flow.parallel_group.merge_failed": IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    groupId: string;
    mergeMode: string;
    error: string;
  };
  [DomainEventType.FlowWaveErrors]: IFlowEventRequestContext & {
    flowRunId: string;
    waveNumber: number;
    errorCount: number;
    errors: IFlowWaveErrorPayload[];
  };
  [DomainEventType.FlowStepProcessingError]: IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    error: string;
  };
  [DomainEventType.FlowOutputAggregating]: IFlowEventRequestContext & {
    flowRunId: string;
    flowId: string;
    outputFrom: IFlow["output"]["from"];
    outputFormat: IFlow["output"]["format"];
    totalSteps: number;
  };
  [DomainEventType.FlowOutputAggregated]: IFlowEventRequestContext & {
    flowRunId: string;
    flowId: string;
    outputLength: number;
  };
  "flow.completed": IFlowEventRequestContext & {
    flowRunId: string;
    flowId: string;
    success: boolean;
    duration: number;
    stepsCompleted: number;
    successfulSteps: number;
    failedSteps: number;
    outputLength: number;
  };
  "flow.failed": IFlowEventRequestContext & {
    flowRunId: string;
    flowId: string;
    error: string;
    errorType: string;
    duration: number;
    stepsAttempted: number;
    successfulSteps: number;
    failedSteps: number;
  };
  [DomainEventType.FlowStepQueued]: IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    identityId: string;
    dependencies: string[];
    inputSource: IFlowStep["input"]["source"];
  };
  [DomainEventType.FlowStepStarted]: IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    identityId: string;
    /** The step's declared strategy, when set. */
    strategy?: string;
  };
  "flow.step.retry": IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    identityId: string;
    attempt: number;
    maxRetries: number;
    error: string;
  };
  "flow.step.fallback": IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    identityId: string;
    fallbackStepId: string;
    fallbackIdentityId: string;
    error: string;
  };
  "flow.step.compensated": IFlowEventRequestContext & {
    flowRunId: string;
    failedStepId: string;
    sourceStepId: string;
    tool: string;
    args: Record<string, JSONValue>;
    success: boolean;
    result?: JSONValue;
    error?: string;
  };
  "flow.step.compensation_failed": IFlowEventRequestContext & {
    flowRunId: string;
    failedStepId: string;
    sourceStepId: string;
    tool: string;
    args: Record<string, JSONValue>;
    error: string;
  };
  [DomainEventType.FlowStepConditionEvaluated]: IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    condition: string;
    shouldExecute: boolean;
    error?: string;
  };
  "flow.step.skipped": IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    condition: string;
    reason: string;
  };
  [DomainEventType.FlowGateCriteriaNoAnalysis]: IFlowEventRequestContext & { flowRunId: string; stepId: string };
  [DomainEventType.FlowStepCompleted]: IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    identityId: string;
    success: true;
    duration: number;
    outputLength: number;
    hasThought: boolean;
    /** The step's declared strategy, when set. */
    strategy?: string;
  };
  [DomainEventType.FlowStepFailed]: IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    identityId: string;
    error: string;
    errorType: string;
    duration: number;
  };
  [DomainEventType.FlowStepTransformApplied]: IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    transformName: string;
    inputSize: number;
    outputSize: number;
    duration: number;
  };
  [DomainEventType.FlowStepInputPrepared]: IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    hasSkills: boolean;
  };
  [DomainEventType.FlowStepUnexpectedError]: IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    error: string;
    errorType: string;
  };
  [DomainEventType.FlowStepReplayed]: IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    recordId: string;
    reason: string;
    flowId: string;
  };
  "flow.step.skipped_by_reuse": IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    priorRecordId: string;
    inputHash: string;
  };
  [DomainEventType.FlowStepInvalidated]: IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    recordId: string;
    reason: string;
  };
  "flow.checkpoint.stale": IFlowEventRequestContext & { flowRunId: string; flowId: string };
  "flow.checkpoint.loaded": IFlowEventRequestContext & { flowRunId: string; flowId: string; restoredSteps: number };
  "flow.checkpoint.saved": IFlowEventRequestContext & { flowRunId: string; flowId: string; completedSteps: number };
  "flow.checkpoint.cleared": IFlowEventRequestContext & { flowRunId: string; flowId: string };
  [DomainEventType.FlowTokenSummary]: {
    flowRunId: string;
    flowId: string;
    totalLlmCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    providers: Record<string, IFlowProviderTokenStats>;
    traceId: string;
    requestId?: string;
  };
  [DomainEventType.FlowTokenSummaryError]: {
    flowRunId: string;
    flowId: string;
    error: string;
    traceId: string;
    requestId?: string;
  };
  [DomainEventType.WaitStateCreated]: IFlowEventLogBase & {
    flowRunId: string;
    stepId: string;
    waitStateId: string;
    resumeToken: string;
    kind: string;
    traceId: string;
  };
  [DomainEventType.WaitStateResolved]: IFlowEventLogBase & {
    flowRunId: string;
    waitStateId: string;
    traceId: string;
    stepIds: string[];
  };
  [DomainEventType.SessionDelegateCycleStarted]: {
    flowRunId: string;
    stepId: string;
    traceId: string;
    planStepCount: number;
  };
  [DomainEventType.SessionDelegateCycleStepCompleted]: {
    flowRunId: string;
    stepId: string;
    traceId: string;
    delegationTraceId: string;
    sequence: number;
  };
  [DomainEventType.SessionDelegateCycleStepRejected]: {
    flowRunId: string;
    stepId: string;
    traceId: string;
    /** Absent for a plan-level rejection (too large / too many steps / parse failure). */
    sequence?: number;
    reason: ISessionDelegateCycleRejectionReason;
  };
  [DomainEventType.SessionDelegateCycleCompleted]: {
    flowRunId: string;
    stepId: string;
    traceId: string;
    stepCount: number;
  };
  [DomainEventType.SessionDelegateCycleResumed]: {
    flowRunId: string;
    stepId: string;
    traceId: string;
  };
}

export type IFlowEventPayload<TEvent extends string> = TEvent extends keyof IFlowEventPayloadMap
  ? IFlowEventPayloadMap[TEvent] & Record<string, JSONValue | undefined>
  : Record<string, JSONValue | undefined>;

/**
 * Result of executing a complete flow
 */
export interface IFlowResult {
  /** Unique flow run identifier */
  flowRunId: string;
  /** Whether the overall flow succeeded */
  success: boolean;
  /** Results for each step */
  stepResults: Map<string, IStepResult>;
  /** Final aggregated output */
  output: string;
  /** Total execution duration */
  duration: number;
  /** When the flow started */
  startedAt: Date;
  /** When the flow completed */
  completedAt: Date;
  /** Absolute path to the persisted namespace artifact; undefined when namespace is disabled */
  namespaceArtifactPath?: string;
  /** Optional token usage summary for the flow */
  tokenSummary?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    token_provider?: string;
    token_model?: string;
    token_cost_usd?: number;
  };
  /** True when the flow is waiting for an operator to resolve a durable wait state. */
  waiting?: boolean;
  /** The wait state ID the flow is waiting on, when waiting=true. */
  waitStateId?: string;
}

/**
 * Interface for logging flow events
 */
export interface IFlowEventLogger {
  log<TEvent extends string>(event: TEvent, payload: IFlowEventPayload<TEvent>): void;
}

/**
 * Error thrown when flow execution fails
 */
export class FlowExecutionError extends Error {
  constructor(message: string, public readonly flowRunId?: Opt<string, Reason.TraceAbsent>) {
    super(message);
    this.name = "FlowExecutionError";
  }
}

export class FlowAbortError extends Error {
  constructor(
    public readonly stepId: string,
    message: string,
    public readonly flowRunId?: Opt<string, Reason.TraceAbsent>,
    public readonly failureResult?: Opt<IStepResult, Reason.OptionalContext>,
  ) {
    super(message);
    this.name = "FlowAbortError";
  }
}

/** Converts an IGateEvaluate (YAML-facing gate config) to a GateConfig (evaluator input),
 *  preserving all fields including `includeRequestCriteria`. */
export function toGateConfig(evaluate: IGateEvaluate): IGateConfig {
  return {
    identity: evaluate.identity,
    criteria: evaluate.criteria,
    threshold: evaluate.threshold,
    onFail: evaluate.onFail,
    maxRetries: evaluate.maxRetries,
    includeRequestCriteria: evaluate.includeRequestCriteria,
  };
}

/** The steps an `aggregate` input draws from: an explicit `from`, else the step's `dependsOn`. An explicit `from`
 *  still wins, so a step may legitimately depend on more than it consumes. Returns empty when neither is
 *  specified, which the caller treats as an error rather than silently aggregating nothing. */
export function resolveAggregateSources(step: { input: { from?: string[] }; dependsOn?: string[] }): string[] {
  if (step.input.from?.length) return step.input.from;
  return step.dependsOn ?? [];
}

/** Output-shape instruction appended to every AGENT step prompt. Without it a real model answers in prose, which
 *  fails both the capture contract (a flow-step response's <content> block must be valid JSON) and, for the final
 *  step, plan validation downstream. Exported so durability tests can seed replay records with the exact prompt hash. */
export function flowStepOutputInstruction(step: IFlowStep, flow: IFlow): string {
  const planShape = `{"subject": "Flow Step Output", "description": "Structured output for this step", ` +
    `"steps": [{"step": 1, "title": "Step title", "description": "What this step produced"}]}`;
  const from = flow.output?.from;
  const isFinalStep = from === step.id || (Array.isArray(from) && from.includes(step.id));
  const purpose = isFinalStep
    ? "You are the FINAL step of a multi-agent flow: your response's <content> block becomes " +
      "the flow's aggregated output and must parse as a plan."
    : "You are a step in a multi-agent flow: your response's <content> block is consumed " +
      "programmatically by the next step.";
  return `\n\n${purpose}\nRespond exactly in this format — no other text outside the tags:\n` +
    `<thought>\nBrief reasoning (1-3 sentences).\n</thought>\n\n` +
    `<content>\n${planShape}\n</content>\n` +
    `The <content> block MUST be valid JSON: the first character after <content> must be ` +
    `{ and the last before </content> must be }, with no prose, explanation, or markdown ` +
    `fences inside it.`;
}

/** Orchestrates multi-agent flow execution: step dispatch, gate evaluation, aggregation. */
export class FlowRunner implements IFlowRunner {
  private conditionEvaluator: ConditionEvaluator;
  protected dynamicStepExecutor?: DynamicStepExecutor;
  private mcpClient?: IMcpClient & IToolManifestResolver;
  private agentExecutor: IAgentExecutor;
  private eventLogger: IFlowEventLogger;
  private db?: IDatabaseService;
  private gateEvaluator?: IGateEvaluator;
  private config?: Config;
  private checkpointService?: IFlowCheckpointService;
  private namespaceService?: IFlowNamespaceService;
  private stepDurabilityStore: IStepDurabilityStore;
  private stepReplayPolicy: IStepReplayPolicy;
  private checkpointCoordinator!: FlowCheckpointCoordinator;
  private namespaceCoordinator!: FlowNamespaceCoordinator;
  private readonly stepOutputFormatter: StepOutputFormatter = new StepOutputFormatter();
  private readonly stepHandlerRegistry = new FlowStepHandlerRegistry();
  private waitStateService?: IWaitStateService;
  private readonly pendingWaitStateRef: IPendingWaitStateRef = { current: undefined };
  private eventRegistry?: IEventRegistry;
  private modelResolver?: ModelResolver;
  private readonly runtimeValidator = new FlowRuntimeValidator();
  private readonly parallelGroupMergeService: ParallelGroupMergeService;
  private readonly retryBudgetService: RetryBudgetService;
  private compensationService!: CompensationService;
  private waveOrchestrator!: WaveOrchestrator;
  private flowTraceStore?: IFlowTraceStore;

  private createNoOpDurabilityStore(): IStepDurabilityStore {
    return {
      save: (_record: IStepExecutionRecord) => Promise.resolve(),
      findReplayCandidate: () => Promise.resolve(null),
      invalidate: (_recordId: string, _reason: string) => Promise.resolve(),
    };
  }

  constructor(
    private readonly options: IFlowRunnerConfig,
  ) {
    this.conditionEvaluator = new ConditionEvaluator();
    this.agentExecutor = options.agentExecutor;
    this.eventLogger = options.eventLogger;
    this.db = options.context?.db || options.db;
    this.gateEvaluator = options.context?.gateEvaluator || options.gateEvaluator;
    this.config = options.context?.config.get() || options.config;
    this.parallelGroupMergeService = new ParallelGroupMergeService(this.eventLogger);
    this.retryBudgetService = new RetryBudgetService(this.config, this.db);
    this.initCoreServices();

    this.stepDurabilityStore = options.stepDurabilityStore ?? this.createNoOpDurabilityStore();
    this.stepReplayPolicy = options.stepReplayPolicy ?? new DefaultStepReplayPolicy();
    this.waitStateService = options.waitStateService;
    this.modelResolver = options.modelResolver;
    this.flowTraceStore = options.flowTraceStore;
    this.checkpointCoordinator = new FlowCheckpointCoordinator({
      checkpointService: this.checkpointService,
      stepDurabilityStore: this.stepDurabilityStore,
      eventLogger: this.eventLogger,
    });
    this.namespaceCoordinator = new FlowNamespaceCoordinator({
      namespaceService: this.namespaceService,
      eventLogger: this.eventLogger,
    });
    this.waveOrchestrator = new WaveOrchestrator(
      this.eventLogger,
      this.checkpointCoordinator,
      this.namespaceCoordinator,
      {
        executeStepSafe: (flowRunId, stepId, flow, request, stepResults) =>
          this.executeStepSafe(flowRunId, stepId, flow, request, stepResults),
        getIFlowLogBase: (flow, request) => this.getIFlowLogBase(flow, request),
        emitMilestone: (milestoneType, traceId, summary, progressHint) =>
          this.emitMilestone(milestoneType, traceId, summary, progressHint),
      },
      options.eventRegistry,
    );

    this.registerEventPublisher(options);

    const config = this.config;
    const db = this.db;
    const dynamicHandlers = options.dynamicHandlers;
    const mcpHandlers = options.mcpHandlers;
    this.initDynamicTools(config, db, dynamicHandlers, mcpHandlers, options);
    this.compensationService = new CompensationService(this.eventLogger, this.mcpClient);

    this.stepHandlerRegistry.register(
      new GateStepHandler({
        gateEvaluator: this.gateEvaluator!,
        eventLogger: this.eventLogger,
        waitStateService: this.waitStateService,
        milestoneEmitter: this.options.milestoneEmitter,
        pendingWaitStateRef: this.pendingWaitStateRef,
      }),
    );
    const agentHandler = new AgentStepHandler({
      agentExecutor: this.agentExecutor,
      dynamicStepExecutor: this.dynamicStepExecutor,
      config: this.config,
    });
    this.stepHandlerRegistry.register(agentHandler);
    // Preserve old fall-through: BRANCH, CONSENSUS, and unknown types all routed to agent
    this.stepHandlerRegistry.registerWithKey(FlowStepType.BRANCH, agentHandler);
    this.stepHandlerRegistry.registerWithKey(FlowStepType.CONSENSUS, agentHandler);
    this.eventLogger.log("flow.deprecation.consensus", { step_type: FlowStepType.CONSENSUS });

    if (options.sessionDelegationCoordinator && options.planContextResolver) {
      this.stepHandlerRegistry.register(
        new SessionDelegateCycleStepHandler({
          coordinator: options.sessionDelegationCoordinator,
          planContextResolver: options.planContextResolver,
          gateEvaluator: this.gateEvaluator!,
          eventLogger: this.eventLogger,
          claimStore: options.sessionDelegateCycleClaimStore ?? createInMemorySessionDelegateCycleClaimStore(),
          cycleStore: options.sessionDelegateCycleStore ?? createInMemorySessionDelegateCycleStore(),
        }),
      );
    }
  }

  /** Resolves the stable parent trace id a session_delegate_cycle flow requires. Reuses a
   *  valid supplied UUID; otherwise mints/reuses one durably keyed by requestId so retry
   *  and restart correlate to the same lineage. */
  private async normalizeCycleParentTraceId(
    request: { traceId?: string; requestId?: string },
    flowRunId: string,
  ): Promise<string> {
    if (request.traceId && isUuid(request.traceId)) return request.traceId;
    if (!request.requestId) {
      throw new FlowExecutionError(
        "session_delegate_cycle requires a traceId or requestId to establish a stable parent trace",
        flowRunId,
      );
    }
    if (!this.flowTraceStore) {
      throw new FlowExecutionError("session_delegate_cycle requires a configured flowTraceStore", flowRunId);
    }
    return await this.flowTraceStore.getOrCreate(request.requestId);
  }

  private initCoreServices(): void {
    if (this.options.checkpointService) {
      this.checkpointService = this.options.checkpointService;
    } else if (this.config) {
      this.checkpointService = new FlowCheckpointService(this.config);
    }
    if (this.config) {
      this.namespaceService = new FlowNamespaceService(this.config);
    }
  }

  private registerEventPublisher(options: IFlowRunnerConfig): void {
    if (!options.eventRegistry) return;
    this.eventRegistry = options.eventRegistry;
    options.eventRegistry.registerPublisher("flow_runner", [
      DomainEventType.WaitStateCreated,
      DomainEventType.WaitStateResolved,
      DomainEventType.FlowStepReplayed,
      DomainEventType.FlowStepInvalidated,
    ]);
  }

  private initDynamicTools(
    config: Opt<Config, Reason.OptionalDependency>,
    _db: Opt<IDatabaseService, Reason.OptionalDependency>,
    dynamicHandlers: Opt<Map<McpToolName, ToolHandler>, Reason.OptionalDependency>,
    mcpHandlers: Opt<ToolHandler[], Reason.OptionalDependency>,
    options: IFlowRunnerConfig,
  ): void {
    const hasDynamicTools = dynamicHandlers !== undefined || mcpHandlers !== undefined ||
      options.mcpClient !== undefined;
    if (!config || !hasDynamicTools || !this.eventLogger) return;

    const activityJournal = new ActivityJournal(this.eventLogger);
    this.mcpClient = options.mcpClient;

    if (this.modelResolver) return;

    const llmClient = new LlmClient(config, undefined, this.options.dynamicModel);
    const confirmationInterceptor = options.confirmationInterceptor ??
      (options.context ? buildConfirmationInterceptor(options.context, config, activityJournal) : undefined);
    this.dynamicStepExecutor = new DynamicStepExecutor(
      this.mcpClient!,
      llmClient,
      activityJournal,
      confirmationInterceptor,
      this.options.milestoneEmitter,
      this.options.hitlPolicyEvaluator,
      this.options.dynamicModeTools,
      this.options.dynamicModeApprovalTools,
    );
  }

  private buildFallbackContext(config: Config, db: Opt<IDatabaseService, Reason.OptionalDependency>): object {
    return {
      config: {
        get: () => config,
        getAll: () => config,
        getConfigPath: () => "",
        reload: () => config,
        getSchemaVersion: () => "1.0.0",
        getPortals: () => [],
        getPortal: (_alias: string) => undefined,
        addPortal: (_alias: string, _path: string) => Promise.resolve(),
        removePortal: (_alias: string) => Promise.resolve(),
      },
      db: db!,
      provider: createProviderStub(),
      display: {
        info: () => Promise.resolve(),
        warn: () => Promise.resolve(),
        error: () => Promise.resolve(),
        debug: () => Promise.resolve(),
        fatal: () => Promise.resolve(),
      },
      git: createGitServiceStub(),
    };
  }

  /** Lazily initialises the dynamic step executor when a modelResolver is configured.
   *  Called at the start of execute() — not in the constructor — because model
   *  resolution is async. */
  private async ensureDynamicExecutor(
    _flow: IFlow,
    _flowRunId: string,
  ): Promise<void> {
    if (this.dynamicStepExecutor || !this.modelResolver || !this.config || !this.eventLogger) {
      return;
    }
    const intent: IModelIntent = {
      model_size: this.options.dynamicModel ? mapPresetToSize(this.options.dynamicModel) : undefined,
    };
    const resolved = await this.modelResolver.resolve(intent);
    const activityJournal = new ActivityJournal(this.eventLogger);
    const config = this.config;
    const db = this.db;
    const _context = (this.options.context || {
      config: {
        get: () => config,
        getAll: () => config,
        getConfigPath: () => "",
        reload: () => config,
        getSchemaVersion: () => "1.0.0",
        getPortals: () => [],
        getPortal: (_alias: string) => undefined,
        addPortal: (_alias: string, _path: string) => Promise.resolve(),
        removePortal: (_alias: string) => Promise.resolve(),
      },
      db: db!,
      provider: createProviderStub(),
      display: {
        info: () => Promise.resolve(),
        warn: () => Promise.resolve(),
        error: () => Promise.resolve(),
        debug: () => Promise.resolve(),
        fatal: () => Promise.resolve(),
      },
      git: createGitServiceStub(),
    }) as IApplicationContext;
    const llmClient = new LlmClient(config, undefined, resolved.model);
    const confirmationInterceptor = this.options.confirmationInterceptor;
    this.dynamicStepExecutor = new DynamicStepExecutor(
      this.mcpClient!,
      llmClient,
      activityJournal,
      confirmationInterceptor,
      this.options.milestoneEmitter,
      this.options.hitlPolicyEvaluator,
      this.options.dynamicModeTools,
      this.options.dynamicModeApprovalTools,
      // Forward the resolver's per-call options (thinking/effort) to every ReAct
      // generate() call in dynamic steps.
      resolved.options,
    );
    // The agent step handler was registered during construction, before the lazy executor
    // existed, so it captured `dynamicStepExecutor: undefined`. Re-register it now.
    const agentHandler = new AgentStepHandler({
      agentExecutor: this.agentExecutor,
      dynamicStepExecutor: this.dynamicStepExecutor,
      config: this.config,
    });
    this.stepHandlerRegistry.register(agentHandler);
    this.stepHandlerRegistry.registerWithKey(FlowStepType.BRANCH, agentHandler);
    this.stepHandlerRegistry.registerWithKey(FlowStepType.CONSENSUS, agentHandler);
  }

  /** Exposes the step-handler registry for external extension; paid-edition handlers
   *  register additional step types here at bootstrap. */
  getStepHandlerRegistry(): FlowStepHandlerRegistry {
    return this.stepHandlerRegistry;
  }

  private async emitMilestone(
    milestoneType: IExecutionMilestone["milestoneType"],
    traceId: Opt<string, Reason.TraceAbsent>,
    summary: string,
    progressHint?: Opt<
      { stepsCompleted?: number; stepsTotal?: number; currentStepLabel?: string },
      Reason.OptionalContext
    >,
    requiresAttention = false,
    attentionReason?: Opt<string, Reason.OptionalContext>,
  ): Promise<void> {
    const emitter = this.options.milestoneEmitter;
    if (!emitter) return;
    await emitter.emit({
      milestoneId: crypto.randomUUID(),
      traceId: traceId ?? "",
      milestoneType,
      requiresAttention,
      attentionReason,
      progressHint,
      occurredAt: new Date().toISOString(),
      summary,
    });
  }

  private getIFlowLogBase(
    flow: IFlow,
    request: { traceId?: string; requestId?: string },
    options: { includeStepCount: true },
  ): IFlowEventPayloadMap["flow.validating"];
  private getIFlowLogBase(
    flow: IFlow,
    request: { traceId?: string; requestId?: string },
    options?: Opt<{ includeStepCount?: false }, Reason.SensibleDefault>,
  ): IFlowEventLogBase;
  private getIFlowLogBase(
    flow: IFlow,
    request: { traceId?: string; requestId?: string },
    options: { includeStepCount?: boolean } = {},
  ): IFlowEventLogBase | IFlowEventPayloadMap["flow.validating"] {
    return {
      flowId: flow.id,
      ...(options.includeStepCount ? { stepCount: flow.steps.length } : {}),
      traceId: request.traceId,
      requestId: request.requestId,
    };
  }

  /**
   * Execute a flow with the given request
   */
  async execute(
    flow: IFlow,
    request: {
      userPrompt: string;
      traceId?: string;
      requestId?: string;
      requestAnalysis?: IRequestAnalysis;
      portal?: string;
      scenarioId?: string;
      stepId?: string;
      executionRoot?: string;
      planContextRef?: string;
    },
  ): Promise<IFlowResult> {
    const flowRunId = crypto.randomUUID();
    const startedAt = new Date();
    const flowContentHash = await this.computeFlowContentHash(flow);

    if (flow.steps.some((step) => step.type === FlowStepType.SESSION_DELEGATE_CYCLE)) {
      request = { ...request, traceId: await this.normalizeCycleParentTraceId(request, flowRunId) };
    }

    // Ensure dynamic step executor is initialized (deferred async init for modelResolver path)
    await this.ensureDynamicExecutor(flow, flowRunId);

    // Validate flow
    await this.validateIFlow(flow, request, flowRunId);

    const stepResults = new Map<string, IStepResult>();

    await this.checkpointCoordinator.loadCheckpointIfAvailable(flow, request, flowRunId, flowContentHash, stepResults);
    await this.namespaceCoordinator.initializeNamespace(
      this.namespaceCoordinator.getNamespaceId(request, flowRunId),
      flow,
    );

    try {
      // Execute waves and aggregate results
      await this.waveOrchestrator.executeWaves(flow, request, flowRunId, flowContentHash, stepResults);

      // If any step entered a wait state, return early without aggregating — the flow
      // will resume when an operator resolves the wait state externally.
      const waitingSteps = [...stepResults.values()].filter((r) => r.waitStateId);
      if (waitingSteps.length > 0) {
        return {
          flowRunId,
          success: true,
          stepResults,
          output: "",
          duration: new Date().getTime() - startedAt.getTime(),
          waiting: true,
          waitStateId: waitingSteps[0].waitStateId,
        } as IFlowResult;
      }

      // Aggregate output and finalize
      return await this.aggregateAndFinalize(flow, request, flowRunId, stepResults, startedAt);
    } catch (error) {
      return await this.handleExecutionError(flow, request, flowRunId, stepResults, startedAt, error);
    }
  }

  /**
   * Validate the flow before execution
   */
  private async validateIFlow(
    flow: IFlow,
    request: IFlowOriginalRequest,
    flowRunId: string,
  ): Promise<void> {
    // Log flow validation start
    await this.eventLogger.log(DomainEventType.FlowValidating, {
      ...this.getIFlowLogBase(flow, request, { includeStepCount: true }),
    });

    // Validate flow has steps
    if (flow.steps.length === 0) {
      await this.eventLogger.log(FLOW_EVENT_VALIDATION_FAILED, {
        error: "IFlow must have at least one step",
        ...this.getIFlowLogBase(flow, request),
      });
      throw new FlowExecutionError("IFlow must have at least one step", flowRunId);
    }

    const fallbackCycle = this.runtimeValidator.findCyclicFallbackChain(flow);
    if (fallbackCycle) {
      const errorMessage = `Cyclic fallback chain detected: ${fallbackCycle.join(" -> ")}`;
      await this.eventLogger.log(FLOW_EVENT_VALIDATION_FAILED, {
        error: errorMessage,
        ...this.getIFlowLogBase(flow, request),
      });
      throw new FlowExecutionError(errorMessage, flowRunId);
    }

    const parallelValidationError = this.runtimeValidator.validateParallelGroups(flow);
    if (parallelValidationError) {
      await this.eventLogger.log(FLOW_EVENT_VALIDATION_FAILED, {
        error: parallelValidationError,
        ...this.getIFlowLogBase(flow, request),
      });
      throw new FlowExecutionError(parallelValidationError, flowRunId);
    }

    const strategyValidationError = this.runtimeValidator.validateStepStrategy(flow);
    if (strategyValidationError) {
      await this.eventLogger.log(FLOW_EVENT_VALIDATION_FAILED, {
        error: strategyValidationError,
        ...this.getIFlowLogBase(flow, request),
      });
      throw new FlowExecutionError(strategyValidationError, flowRunId);
    }

    if (this.agentExecutor.hasBlueprint) {
      const identityValidationError = await this.runtimeValidator.validateStepIdentities(
        flow,
        (identityId) => this.agentExecutor.hasBlueprint!(identityId),
      );
      if (identityValidationError) {
        await this.eventLogger.log(FLOW_EVENT_VALIDATION_FAILED, {
          error: identityValidationError,
          ...this.getIFlowLogBase(flow, request),
        });
        throw new FlowExecutionError(identityValidationError, flowRunId);
      }
    }

    // Log flow validation success
    await this.eventLogger.log(DomainEventType.FlowValidated, {
      maxParallelism: flow.settings?.maxParallelism ?? 3,
      failFast: flow.settings?.failFast ?? true,
      ...this.getIFlowLogBase(flow, request, { includeStepCount: true }),
    });
  }

  /**
   * Aggregate output and create final flow result
   */
  private async aggregateAndFinalize(
    flow: IFlow,
    request: IFlowOriginalRequest,
    flowRunId: string,
    stepResults: Map<string, IStepResult>,
    startedAt: Date,
  ): Promise<IFlowResult> {
    // Aggregate output
    await this.eventLogger.log(DomainEventType.FlowOutputAggregating, {
      flowRunId,
      flowId: flow.id,
      outputFrom: flow.output?.from,
      outputFormat: flow.output?.format,
      totalSteps: stepResults.size,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    const output = this.stepOutputFormatter.aggregateOutput(flow.output, stepResults);

    await this.eventLogger.log(DomainEventType.FlowOutputAggregated, {
      flowRunId,
      flowId: flow.id,
      outputLength: output.length,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    const completedAt = new Date();
    const duration = completedAt.getTime() - startedAt.getTime();

    // Determine overall success
    const success = Array.from(stepResults.values()).every((result) => result.success);
    const successfulSteps = Array.from(stepResults.values()).filter((r) => r.success).length;
    const failedSteps = stepResults.size - successfulSteps;

    await this.checkpointCoordinator.clearCheckpointOnSuccess(flow, request, flowRunId, success);

    // Log flow completion
    await this.eventLogger.log(FLOW_EVENT_COMPLETED, {
      flowRunId,
      flowId: flow.id,
      success,
      duration,
      stepsCompleted: stepResults.size,
      successfulSteps,
      failedSteps,
      outputLength: output.length,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    await this.emitMilestone(
      MILESTONE_FLOW_COMPLETED,
      request.traceId,
      success ? "Flow completed successfully" : "Flow completed with failures",
      {
        stepsCompleted: stepResults.size,
        stepsTotal: flow.steps.length,
      },
    );

    // Aggregate and log token usage summary
    const tokenSummary = (this.db && request.traceId)
      ? await this.aggregateAndLogTokenUsage(flowRunId, flow.id, request.traceId, request.requestId)
      : null;
    const namespaceArtifactPath = this.namespaceService && flow.namespace?.enabled
      ? this.namespaceService.getNamespacePath(this.namespaceCoordinator.getNamespaceId(request, flowRunId))
      : undefined;

    return {
      flowRunId,
      success,
      stepResults,
      output,
      duration,
      startedAt,
      completedAt,
      namespaceArtifactPath,
      tokenSummary: tokenSummary ?? undefined,
    };
  }

  /**
   * Handle execution errors and create error result
   */
  private async handleExecutionError(
    flow: IFlow,
    request: IFlowOriginalRequest,
    flowRunId: string,
    stepResults: Map<string, IStepResult>,
    startedAt: Date,
    error: Error | string | unknown,
  ): Promise<never> {
    const completedAt = new Date();
    const duration = completedAt.getTime() - startedAt.getTime();

    // Determine partial results
    const successfulSteps = Array.from(stepResults.values()).filter((r) => r.success).length;
    const failedSteps = stepResults.size - successfulSteps;

    // Log flow failure
    await this.eventLogger.log("flow.failed", {
      flowRunId,
      flowId: flow.id,
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : DEFAULT_UNKNOWN_LABEL,
      duration,
      stepsAttempted: stepResults.size,
      successfulSteps,
      failedSteps,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    await this.emitMilestone(
      MILESTONE_FLOW_FAILED,
      request.traceId,
      `Flow failed: ${error instanceof Error ? error.message : String(error)}`,
      { stepsCompleted: stepResults.size, stepsTotal: flow.steps.length },
      true,
      "Flow execution encountered an unrecoverable error",
    );

    throw error;
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    flowRunId: string,
    stepId: string,
    flow: IFlow,
    request: IFlowOriginalRequest,
    stepResults: Map<string, IStepResult>,
  ): Promise<IStepResult> {
    const step = flow.steps.find((s) => s.id === stepId)!;
    const startedAt = new Date();
    const stepCtx: IStepContext = { flowRunId, step, flow, request, stepResults, startedAt };

    // Evaluate step condition if present
    const conditionResult = await this.evaluateStepCondition(flowRunId, step, flow, stepResults, request, startedAt);
    if (conditionResult) {
      return conditionResult;
    }

    // Log step queued (ready for execution)
    await this.eventLogger.log(DomainEventType.FlowStepQueued, {
      flowRunId,
      stepId,
      identityId: step.identity,
      dependencies: step.dependsOn,
      inputSource: step.input.source,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    // Log step start
    await this.eventLogger.log(DomainEventType.FlowStepStarted, {
      flowRunId,
      stepId,
      identityId: step.identity,
      strategy: step.strategy,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    await this.emitMilestone(MILESTONE_FLOW_STEP_STARTED, request.traceId, `Step ${step.name || step.id} started`, {
      currentStepLabel: step.name || step.id,
    });

    try {
      const attemptOutcome = await this.runStepAttempt(stepCtx);
      return this.formatStepSuccess(
        stepCtx,
        attemptOutcome.result,
        undefined,
        attemptOutcome.namespaceWrites,
      );
    } catch (error) {
      return await this.handleStepFailureRecovery(
        stepCtx,
        error,
      );
    }
  }

  /**
   * Execute a single step attempt without applying recovery policy.
   */
  private async runStepAttempt(
    ctx: IStepContext,
    attemptClass: Opt<StepAttemptClass, Reason.SensibleDefault> = StepAttemptClass.INITIAL,
  ): Promise<{ result: IAgentExecutionResult; namespaceWrites?: IStepNamespaceWrites }> {
    const { flowRunId, step, flow, request, stepResults, startedAt } = ctx;
    const stepRequest = await this.prepareStepRequest(flowRunId, step, flow, request, stepResults);
    const inputHash = await this.computeStepInputHash(stepRequest);
    const stepId = step.id;
    const traceId = request.traceId ?? flowRunId;

    const toolPolicyHash = await this.computeStringHash(JSON.stringify(step.permitted_tools ?? []));
    const portalScopeHash = await this.computeStringHash(JSON.stringify([]));

    const priorRecord = await this.stepDurabilityStore.findReplayCandidate({
      traceId,
      flowId: flow.id,
      stepId,
      inputHash,
      attemptClass,
      toolPolicyHash,
      portalScopeHash,
    });

    if (priorRecord) {
      const reuseDecision = this.stepReplayPolicy.canReuse({
        step: { userPrompt: stepRequest.userPrompt, context: stepRequest.context ?? {} },
        prior: priorRecord,
        currentInputHash: inputHash,
      });

      if (reuseDecision.allowed) {
        this.eventLogger.log(FLOW_EVENT_STEP_SKIPPED_BY_REUSE, {
          traceId,
          requestId: request.requestId,
          flowRunId,
          stepId,
          priorRecordId: priorRecord.recordId,
          inputHash,
        });

        void this.emitMilestone(MILESTONE_FLOW_STEP_REPLAYED, traceId, `Step ${step.name || step.id} replayed`);

        return {
          result: {
            thought: "(replayed)",
            content: priorRecord.summary ?? "",
            raw: priorRecord.summary ?? "",
          },
        };
      }
    }

    const recordId = crypto.randomUUID();
    const record: IStepExecutionRecord = {
      recordId,
      traceId,
      flowId: flow.id,
      stepId,
      idempotencyKey: {
        traceId,
        flowId: flow.id,
        stepId,
        attemptClass,
        inputHash,
        toolPolicyHash,
        portalScopeHash,
      },
      disposition: StepExecutionDisposition.EXECUTED,
      startedAt: startedAt.toISOString(),
      inputHash,
      sideEffectClass: StepSideEffectClass.MIXED,
      replayEligible: false,
    };

    record.sideEffectClass = this.computeSideEffectClass(step);

    await this.stepDurabilityStore.save(record);

    try {
      const result = await this.executeStepLogic(flowRunId, step, flow, request, stepRequest, startedAt);
      record.completedAt = new Date().toISOString();
      record.durationMs = Date.now() - startedAt.getTime();
      record.replayEligible = true;
      record.summary = result.content;
      await this.stepDurabilityStore.save(record);

      const writes = step.namespace?.writes ?? [];

      return {
        result,
        namespaceWrites: writes.length > 0
          ? {
            writes,
            stepOutput: result.content,
          }
          : undefined,
      };
    } catch (error) {
      record.completedAt = new Date().toISOString();
      record.error = error instanceof Error ? error.message : String(error);
      record.replayEligible = false;
      await this.stepDurabilityStore.save(record);
      throw error;
    }
  }

  /**
   * Apply retry, fallback, or abort recovery policy after a step failure.
   */
  private async handleStepFailureRecovery(
    ctx: IStepContext,
    initialError: Error | string | unknown,
  ): Promise<IStepResult> {
    const { flowRunId, step, flow, request, stepResults, startedAt } = ctx;
    if (!step.onError) {
      return this.formatStepFailure(flowRunId, step, request, initialError, startedAt);
    }

    let lastError: Error | string | unknown = initialError;

    if (step.onError.action === FlowStepOnErrorAction.RETRY) {
      const maxRetries = step.onError.maxRetries ?? 1;
      const retryBackoffMs = step.onError.backoffMs ?? DEFAULT_FLOW_STEP_BACKOFF_MS;

      for (let retryAttempt = 1; retryAttempt <= maxRetries; retryAttempt++) {
        await this.retryBudgetService.enforceRetryCostBudget(flowRunId, request);

        await this.eventLogger.log(FLOW_EVENT_STEP_RETRY, {
          flowRunId,
          stepId: step.id,
          identityId: step.identity,
          attempt: retryAttempt,
          maxRetries,
          error: lastError instanceof Error ? lastError.message : String(lastError),
          traceId: request.traceId,
          requestId: request.requestId,
        });

        await this.retryBudgetService.applyRetryBackoff(retryBackoffMs, retryAttempt);

        try {
          const retryOutcome = await this.runStepAttempt(ctx);
          return this.formatStepSuccess(
            ctx,
            retryOutcome.result,
            {
              wasRetried: true,
              retryCount: retryAttempt,
            },
            retryOutcome.namespaceWrites,
          );
        } catch (retryError) {
          lastError = retryError;
        }
      }
    }

    if (step.onError.action === FlowStepOnErrorAction.FALLBACK) {
      const fallbackStepId = step.onError.fallbackStep;
      const fallbackStep = fallbackStepId ? flow.steps.find((candidate) => candidate.id === fallbackStepId) : null;

      if (!fallbackStep) {
        lastError = new Error(
          `Fallback step not found for ${step.id}: ${fallbackStepId ?? DEFAULT_UNKNOWN_LABEL}`,
        );
      } else {
        await this.eventLogger.log(FLOW_EVENT_STEP_FALLBACK, {
          flowRunId,
          stepId: step.id,
          identityId: step.identity,
          fallbackStepId: fallbackStep.id,
          fallbackIdentityId: fallbackStep.identity,
          error: lastError instanceof Error ? lastError.message : String(lastError),
          traceId: request.traceId,
          requestId: request.requestId,
        });

        try {
          const fallbackResult = await this.executeStep(flowRunId, fallbackStep.id, flow, request, stepResults);
          return this.mapFallbackResultToPrimaryResult(
            flowRunId,
            step,
            fallbackStep,
            request,
            fallbackResult,
            startedAt,
          );
        } catch (fallbackError) {
          if (fallbackError instanceof FlowAbortError) {
            throw fallbackError;
          }
          lastError = fallbackError;
        }
      }
    }

    const failureResult = this.formatStepFailure(flowRunId, step, request, lastError, startedAt);

    if (step.onError.action === FlowStepOnErrorAction.COMPENSATE) {
      await this.compensationService.executeCompensatingTransactions(flowRunId, step, flow, request, stepResults);
    }

    if (step.onError.action === FlowStepOnErrorAction.ABORT) {
      throw new FlowAbortError(
        step.id,
        failureResult.error ?? DEFAULT_UNKNOWN_ERROR_MESSAGE,
        flowRunId,
        failureResult,
      );
    }

    return failureResult;
  }

  private mapFallbackResultToPrimaryResult(
    flowRunId: string,
    step: IFlowStep,
    fallbackStep: IFlowStep,
    request: IFlowOriginalRequest,
    fallbackResult: IStepResult,
    startedAt: Date,
  ): IStepResult {
    if (!fallbackResult.success) {
      return this.formatStepFailure(
        flowRunId,
        { ...step, identity: fallbackStep.identity },
        request,
        fallbackResult.error ?? DEFAULT_UNKNOWN_ERROR_MESSAGE,
        startedAt,
      );
    }

    if (fallbackResult.skipped || !fallbackResult.result) {
      return {
        ...fallbackResult,
        stepId: step.id,
        fallbackUsed: true,
      };
    }

    return this.formatStepSuccess(
      { flowRunId, step: { ...step, identity: fallbackStep.identity }, request, startedAt },
      fallbackResult.result,
      {
        fallbackUsed: true,
        wasRetried: fallbackResult.wasRetried,
        retryCount: fallbackResult.retryCount,
      },
      fallbackResult.namespaceWrites,
    );
  }

  /**
   * Evaluate step condition and return skip result if condition fails
   */
  private async evaluateStepCondition(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    stepResults: Map<string, IStepResult>,
    request: IFlowOriginalRequest,
    startedAt: Date,
  ): Promise<IStepResult | null> {
    if (!step.condition) {
      return null;
    }

    const conditionResult = this.conditionEvaluator.evaluateStepCondition(step, stepResults, request, flow);

    await this.eventLogger.log(DomainEventType.FlowStepConditionEvaluated, {
      flowRunId,
      stepId: step.id,
      condition: step.condition,
      shouldExecute: conditionResult.shouldExecute,
      error: conditionResult.error,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    if (!conditionResult.shouldExecute) {
      const completedAt = new Date();
      const duration = completedAt.getTime() - startedAt.getTime();

      await this.eventLogger.log(FLOW_EVENT_STEP_SKIPPED, {
        flowRunId,
        stepId: step.id,
        condition: step.condition,
        reason: conditionResult.error || "Condition evaluated to false",
        traceId: request.traceId,
        requestId: request.requestId,
      });

      await this.emitMilestone(
        MILESTONE_FLOW_STEP_SKIPPED,
        request.traceId,
        `Step ${step.name || step.id} skipped: ${conditionResult.error || "Condition not met"}`,
      );

      return {
        stepId: step.id,
        success: true,
        skipped: true,
        skipReason: conditionResult.error || `Condition "${step.condition}" evaluated to false`,
        duration,
        startedAt,
        completedAt,
      };
    }

    return null;
  }

  /**
   * Execute step logic by dispatching to a registered IFlowStepHandler.
   */
  private async executeStepLogic(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    request: IFlowOriginalRequest,
    stepRequest: IFlowStepRequest,
    startedAt: Date,
  ): Promise<IAgentExecutionResult> {
    const stepType = step.type ?? FlowStepType.AGENT;
    const handler = this.stepHandlerRegistry.get(stepType);
    if (!handler) {
      throw new UnknownFlowStepError(stepType, step.id, this.stepHandlerRegistry.keys());
    }
    const flowLogBase = this.getIFlowLogBase(flow, request);
    const ctx: IStepExecutionContext = {
      stepType,
      step,
      flow: { id: flow.id, settings: flow.settings },
      request: {
        userPrompt: request.userPrompt,
        traceId: request.traceId,
        requestId: request.requestId,
        requestAnalysis: request.requestAnalysis,
        executionRoot: request.executionRoot,
        planContextRef: request.planContextRef,
      },
      stepRequest: {
        userPrompt: stepRequest.userPrompt,
        context: stepRequest.context ?? {},
        traceId: stepRequest.traceId,
        requestId: stepRequest.requestId,
        scenarioId: stepRequest.scenarioId,
        stepId: stepRequest.stepId,
        flowStepId: stepRequest.flowStepId,
        requestAnalysis: stepRequest.requestAnalysis,
        skills: stepRequest.skills,
        sharedNamespace: stepRequest.sharedNamespace,
        parallelGroupResults: stepRequest.parallelGroupResults,
        portal: stepRequest.portal,
      },
      flowRunId,
      startedAt,
      flowLogBase,
    };
    return await handler.execute(ctx);
  }

  /**
   * Format successful step result
   */
  private formatStepSuccess(
    ctx: IFormatStepSuccessContext,
    result: IAgentExecutionResult,
    recoveryMetadata?: Opt<IStepRecoveryMetadata, Reason.OptionalInput>,
    namespaceWrites?: Opt<IStepNamespaceWrites, Reason.OptionalInput>,
  ): IStepResult {
    const { flowRunId, step, request, startedAt } = ctx;
    const completedAt = new Date();
    const duration = completedAt.getTime() - startedAt.getTime();

    this.eventLogger.log(DomainEventType.FlowStepCompleted, {
      flowRunId,
      stepId: step.id,
      identityId: step.identity,
      success: true,
      duration,
      outputLength: result.content.length,
      hasThought: !!result.thought,
      strategy: step.strategy,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    void this.emitMilestone(MILESTONE_FLOW_STEP_COMPLETED, request.traceId, `Step ${step.name || step.id} completed`, {
      currentStepLabel: step.name || step.id,
    });

    const waitStateId = this.pendingWaitStateRef.current;
    this.pendingWaitStateRef.current = undefined;

    return {
      stepId: step.id,
      success: true,
      result,
      duration,
      startedAt,
      completedAt,
      namespaceWrites,
      waitStateId,
      ...recoveryMetadata,
    };
  }

  /**
   * Format failed step result
   */
  private formatStepFailure(
    flowRunId: string,
    step: IFlowStep,
    request: IFlowOriginalRequest,
    error: Error | string | unknown,
    startedAt: Date,
  ): IStepResult {
    const completedAt = new Date();
    const duration = completedAt.getTime() - startedAt.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = error instanceof Error ? error.constructor.name : DEFAULT_UNKNOWN_LABEL;

    this.eventLogger.log(DomainEventType.FlowStepFailed, {
      flowRunId,
      stepId: step.id,
      identityId: step.identity,
      error: errorMessage,
      errorType,
      duration,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    return {
      stepId: step.id,
      success: false,
      error: errorMessage,
      duration,
      startedAt,
      completedAt,
    };
  }

  /**
   * Prepare the request for a step execution
   */
  private async prepareStepRequest(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    originalRequest: IFlowOriginalRequest & { scenarioId?: string; stepId?: string },
    stepResults: Map<string, IStepResult>,
  ): Promise<IFlowStepRequest> {
    const inputData = this.collectStepInputData(step, originalRequest, stepResults);
    const userPrompt = await this.buildStepUserPrompt(flowRunId, step, flow, originalRequest, inputData);

    // Merge skills: step-level skills override flow-level defaults
    const skills = step.skills ?? flow.defaultSkills;

    // Log input.prepared event for test visibility
    await this.eventLogger.log(DomainEventType.FlowStepInputPrepared, {
      flowRunId,
      stepId: step.id,
      hasSkills: !!skills && Array.isArray(skills) ? skills.length > 0 : !!skills,
      traceId: originalRequest.traceId,
      requestId: originalRequest.requestId,
    });

    const stepRequest: IFlowStepRequest = {
      userPrompt,
      context: {},
      traceId: originalRequest.traceId,
      requestId: originalRequest.requestId,
      scenarioId: originalRequest.scenarioId,
      stepId: originalRequest.stepId,
      flowStepId: step.id,
      skills,
      requestAnalysis: originalRequest.requestAnalysis,
      portal: originalRequest.portal,
    };

    const stepRequestWithParallelGroups = this.parallelGroupMergeService.attachParallelGroupResults(
      stepRequest,
      flowRunId,
      step,
      flow,
      originalRequest,
      stepResults,
    );

    return await this.namespaceCoordinator.attachSharedNamespace(
      stepRequestWithParallelGroups,
      flowRunId,
      step,
      flow,
      originalRequest,
    );
  }

  private collectStepInputData(
    step: IFlowStep,
    originalRequest: { userPrompt: string },
    stepResults: Map<string, IStepResult>,
  ): string {
    switch (step.input.source) {
      case FlowInputSource.REQUEST:
        return originalRequest.userPrompt;

      case "step":
        return this.getStepResultContent(step, step.input.stepId, stepResults);

      case "aggregate":
        return this.getAggregatedStepInput(step, stepResults);

      default:
        throw new Error(`Invalid input source: ${step.input.source}`);
    }
  }

  private getStepResultContent(
    step: IFlowStep,
    sourceStepId: Opt<string, Reason.OptionalInput>,
    stepResults: Map<string, IStepResult>,
  ): string {
    if (!sourceStepId) {
      throw new Error(`Step ${step.id} has source "step" but no stepId specified`);
    }

    const sourceResult = stepResults.get(sourceStepId);
    if (!sourceResult?.result) {
      throw new Error(`Step ${step.id} depends on ${sourceStepId} which has no result`);
    }

    return sourceResult.result.content;
  }

  private getAggregatedStepInput(
    step: IFlowStep,
    stepResults: Map<string, IStepResult>,
  ): string {
    const from = resolveAggregateSources(step);

    if (from.length === 0) {
      throw new Error(
        `Step ${step.id} has source "aggregate" but neither "from" nor "dependsOn" names a step to aggregate`,
      );
    }

    const aggregatedInputs = from.map((stepId) => this.getStepResultContent(step, stepId, stepResults));
    return aggregatedInputs.length === 1 ? aggregatedInputs[0] : aggregatedInputs.join("\n\n");
  }

  private async buildStepUserPrompt(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    originalRequest: { userPrompt: string; traceId?: string; requestId?: string },
    inputData: string,
  ): Promise<string> {
    const transformStart = Date.now();
    const basePrompt = step.input.transform
      ? this.stepOutputFormatter.applyTransform(
        inputData,
        step.input.transform as string | ((input: string) => string),
        step.input.transformArgs as JSONValue | undefined,
        originalRequest.userPrompt,
      )
      : inputData;

    if (step.input.transform) {
      await this.eventLogger.log(DomainEventType.FlowStepTransformApplied, {
        flowRunId,
        stepId: step.id,
        transformName: typeof step.input.transform === "string" ? step.input.transform : "custom",
        inputSize: inputData.length,
        outputSize: basePrompt.length,
        duration: Date.now() - transformStart,
        traceId: originalRequest.traceId,
        requestId: originalRequest.requestId,
      });
    }

    // A strategy-declared step (react/cli_delegate/mcp) gets its output-format instruction from the strategy's own
    // prompt, NOT the flow step's <content> plan-envelope instruction — injecting the latter makes a live model
    // respond with a JSON plan instead of tool actions. Plain no-strategy agent steps keep the envelope.
    const userPrompt = step.type === FlowStepType.GATE || step.strategy
      ? basePrompt
      : `${basePrompt}${flowStepOutputInstruction(step, flow)}`;

    return userPrompt;
  }

  /** Safe wrapper around `executeStep` to ensure unexpected throws are converted into an
   *  `IStepResult` and do not propagate. */
  private async executeStepSafe(
    flowRunId: string,
    stepId: string,
    flow: IFlow,
    request: IFlowOriginalRequest,
    stepResults: Map<string, IStepResult>,
  ): Promise<IStepResult> {
    try {
      return await this.executeStep(flowRunId, stepId, flow, request, stepResults);
    } catch (error) {
      if (error instanceof FlowAbortError) {
        throw error;
      }

      // Log unexpected error and return a safe failure IStepResult
      try {
        await this.eventLogger.log(DomainEventType.FlowStepUnexpectedError, {
          flowRunId,
          stepId,
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : DEFAULT_UNKNOWN_LABEL,
          traceId: request.traceId,
          requestId: request.requestId,
        });
      } catch {
        // Swallow logging errors to avoid cascading failures
      }

      return {
        stepId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      };
    }
  }

  private async computeFlowContentHash(flow: IFlow): Promise<string> {
    const serialized = JSON.stringify(flow, (_key, value) => {
      return typeof value === "function" ? "__function__" : value;
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
    return encodeHex(digest);
  }

  private async computeStepInputHash(stepRequest: IFlowStepRequest): Promise<string> {
    const serialized = JSON.stringify({
      userPrompt: stepRequest.userPrompt,
      context: stepRequest.context,
      skills: stepRequest.skills,
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
    return encodeHex(digest);
  }

  private async computeStringHash(value: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return encodeHex(digest);
  }

  private computeSideEffectClass(step: IFlowStep): StepSideEffectClass {
    if (step.type === FlowStepType.GATE) {
      return StepSideEffectClass.NONE;
    }

    const hasTools = step.permitted_tools && step.permitted_tools.length > 0;
    const isDynamic = step.execution_mode === FlowStepExecutionMode.DYNAMIC;

    if (isDynamic && hasTools) {
      const hasGitTools = step.permitted_tools!.some((t) => t.startsWith("git_"));
      return hasGitTools ? StepSideEffectClass.GIT : StepSideEffectClass.TOOL;
    }

    if (!isDynamic && !hasTools) {
      return StepSideEffectClass.LLM;
    }

    return StepSideEffectClass.MIXED;
  }

  /**
   * Aggregate token usage across all LLM calls in a flow and log summary
   */
  private async aggregateAndLogTokenUsage(
    flowRunId: string,
    flowId: string,
    traceId: string,
    requestId?: Opt<string, Reason.OptionalContext>,
  ): Promise<IFlowResult["tokenSummary"] | null> {
    try {
      // Query all LLM usage events for this trace
      const tokenEvents = await this.db!.queryActivity({
        traceId,
        actionType: "llm.usage",
      });

      if (tokenEvents.length === 0) {
        // No token usage found, log zero summary
        await this.eventLogger.log(DomainEventType.FlowTokenSummary, {
          flowRunId,
          flowId,
          totalLlmCalls: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalCostUsd: 0,
          providers: {},
          traceId,
          requestId,
        });
        return null;
      }

      // Aggregate token usage by provider
      const providerStats: Record<string, {
        calls: number;
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
      }> = {};

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCostUsd = 0;
      const models = new Set<string>();

      for (const event of tokenEvents) {
        try {
          const payload = JSON.parse(event.payload);
          const provider = payload.provider || event.target || "unknown";
          const inputTokens = payload.input_tokens ?? payload.prompt_tokens ?? 0;
          const outputTokens = payload.output_tokens ?? payload.completion_tokens ?? 0;
          const costUsd = payload.cost_usd || 0;
          const model = payload.model as string | undefined;

          // Initialize provider stats if not exists
          if (!providerStats[provider]) {
            providerStats[provider] = {
              calls: 0,
              inputTokens: 0,
              outputTokens: 0,
              costUsd: 0,
            };
          }

          // Accumulate stats
          providerStats[provider].calls++;
          providerStats[provider].inputTokens += inputTokens;
          providerStats[provider].outputTokens += outputTokens;
          providerStats[provider].costUsd += costUsd;

          totalInputTokens += inputTokens;
          totalOutputTokens += outputTokens;
          totalCostUsd += costUsd;
          if (model) {
            models.add(model);
          }
        } catch (_parseError) {
          // Skip malformed token events
          console.warn(`Skipping malformed token event: ${event.payload}`);
        }
      }

      // Log aggregated token summary
      await this.eventLogger.log(DomainEventType.FlowTokenSummary, {
        flowRunId,
        flowId,
        totalLlmCalls: tokenEvents.length,
        totalInputTokens,
        totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        totalCostUsd: Math.round(totalCostUsd * DEFAULT_COST_PRECISION_FACTOR) / DEFAULT_COST_PRECISION_FACTOR, // Round to 4 decimal places
        providers: providerStats,
        traceId,
        requestId,
      });

      return {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_tokens: totalInputTokens + totalOutputTokens,
        token_provider: Object.keys(providerStats).join(", ") || undefined,
        token_model: models.size > 0 ? Array.from(models).join(", ") : undefined,
        token_cost_usd: Math.round(totalCostUsd * DEFAULT_COST_PRECISION_FACTOR) / DEFAULT_COST_PRECISION_FACTOR,
      };
    } catch (error) {
      // Log error but don't fail the flow
      console.warn(`Failed to aggregate token usage for flow ${flowRunId}:`, error);
      try {
        await this.eventLogger.log(DomainEventType.FlowTokenSummaryError, {
          flowRunId,
          flowId,
          error: error instanceof Error ? error.message : String(error),
          traceId,
          requestId,
        });
      } catch {
        // Swallow logging errors to avoid cascading failures
      }
      return null;
    }
  }
}
