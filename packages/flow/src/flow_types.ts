/**
 * @module FlowTypes
 * @path packages/flow/src/flow_types.ts
 * @description The contracts of the flow runner: executor, runner and event logger interfaces, step and flow results, and the typed event payload map.
 * @architectural-layer Flow
 * @related-files [packages/flow/src/flow_runner.ts, packages/flow/mod.ts]
 */

import type {
  IFlow,
  IFlowNamespaceWrite,
  IFlowStep,
  ISessionDelegateCycleRejectionReason,
} from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { JSONValue } from "@exaix/core";
import type { IDatabaseService } from "@exaix/storage-sqlite";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import type { IBindingRunSnapshot } from "@exaix/schemas";
import type { ModelBindingService } from "@exaix/ai";
import type { FlowStepSkipCode } from "@exaix/core";
import type { IMcpClient } from "@exaix/mcp";
import type { IToolManifestResolver } from "@exaix/core/types";
import type { ModelResolver } from "@exaix/ai";
import type { EffortDeclaration, ThinkingDeclaration } from "@exaix/schemas";
import type { ToolHandler } from "@exaix/mcp/server";
import type { McpToolName } from "@exaix/mcp";
import type { Config } from "@exaix/schemas/config.ts";
import type {
  IApplicationContext,
  IGateEvaluator,
  IHitlPolicyEvaluator,
  IToolConfirmationInterceptor,
} from "@exaix/core/types";
import type {
  IFlowBranchDecidedEventPayload,
  IFlowGateEvaluatedEventPayload,
  IFlowLoopIterationEventPayload,
} from "@exaix/core/events";
import type { IFlowTraceStore } from "./flow_trace_store.ts";
import type { IPlanContextResolver } from "./plan_context_resolver.ts";
import type { ISessionDelegationCoordinator } from "@exaix/session/session_delegation.ts";
import type { ISessionDelegateCycleClaimStore } from "@exaix/session/session_delegate_cycle_claim_store.ts";
import type { ISessionDelegateCycleStore } from "@exaix/session/session_delegate_cycle_store.ts";
import type { IFlowCheckpointService } from "@exaix/flow";
import type { IMilestoneEmitter } from "@exaix/core/observability";
import type { IEventLogger } from "@exaix/core/logger";
import type { ITokenizer } from "@exaix/core/func";
import type { PromptBudgetAllocator } from "@exaix/core";
import type { DomainEventType, IEventRegistry } from "@exaix/core/events";
import type { IStepDurabilityStore, IStepReplayPolicy } from "./contracts/step_durability.ts";
import type { IExecutionMilestone } from "@exaix/schemas";
import type { IRecordingLaneSource, Opt, Reason } from "@exaix/core/types";
import type { IFlowRecordingContext } from "./contracts/flow_recording_context.ts";

/**
 * Interface for agent executors (IAgentRunner or similar)
 */
export interface IAgentExecutor {
  run(agentRole: string, request: IFlowStepRequest): Promise<IAgentExecutionResult>;
  /** Trusted cycle review publishes reconciled paths for later cumulative strategy audits. */
  recordReviewedWrites?: Opt<
    (traceId: string, executionRoot: string, paths: readonly string[], portalAlias: string) => Promise<void>,
    Reason.OptionalDependency
  >;
  /** Optional blueprint-existence probe. */
  hasBlueprint?(agentRole: string): Promise<boolean>;
  /** Strategy-routed step execution: forces `agentRole` through the agent strategy registry,
   * bypassing `run()`'s single generate call. Absent executors fail fast rather than falling back. */
  runWithStrategy?(
    agentRole: string,
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
      flowId?: string;
      bindingSnapshot?: IBindingRunSnapshot;
      /** Trusted canonical request path beneath Workspace/Requests.
       *  It lets the run claim an operator per-run binding file.
       *  It is never taken from request-file content. */
      requestPath?: string;
      /** SHA-256 of the exact request bytes read from `requestPath` by the daemon. */
      requestSha256?: string;
      /** True when the scenario request opted into run-local fixture recording lanes. */
      recordingLanes?: boolean;
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
  /** Call-site key, so LLM calls can be addressed by call site instead of prompt hash. */
  scenarioId?: string;
  stepId?: string;
  /** The id of the flow step that submitted the request, so parallel steps keep distinct call sites. */
  flowStepId?: string;
  flowId?: string;
  flowOutputKind?: "branch-json";
  bindingSnapshot?: IBindingRunSnapshot;
  /** Run-local fixture recording allocator of an opted-in scenario run. */
  recording?: IRecordingLaneSource;
  /** Recording lane for this call when it differs from `flowStepId`, such as one voter of a group. */
  recordingLaneId?: string;
  /** Skills to apply for this step execution */
  skills?: string[];
  /** Structured request analysis. */
  requestAnalysis?: IRequestAnalysis;
  /** Resolved namespace reads for this step, keyed by binding key. */
  sharedNamespace?: Record<string, string>;
  /** Deterministic summaries for requested parallel groups. */
  parallelGroupResults?: Record<string, IParallelGroupSummary>;
  /** The flow's portal alias, threaded unchanged from `FlowRunner.execute()`'s `request.portal`. */
  portal?: string;
  /** True for the terminal step of a plan-format flow. */
  expectPlanJsonOutput?: boolean;
  /** Per-step reasoning-effort declaration from the step YAML ("auto" defers to
   *  EffortResolver). */
  effort?: EffortDeclaration;
  /** Per-step thinking declaration from the step YAML ("auto" defers to EffortResolver). */
  thinking?: ThinkingDeclaration;
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
  edition?: Opt<string, Reason.OptionalInput>;
  installedCapabilities?: Opt<ReadonlySet<string>, Reason.OptionalDependency>;
  agentExecutor: IAgentExecutor;
  bindingService?: ModelBindingService;
  eventLogger: IFlowEventLogger;
  /** Optional logger for provider-level LLM lifecycle events. */
  llmEventLogger?: IEventLogger;
  /** Tokenizer shared with prompt budgeting for native dynamic snapshots. */
  tokenizer?: ITokenizer;
  /** Shared section allocator used to reject oversized dynamic native snapshots before I/O. */
  promptBudgetAllocator?: Pick<PromptBudgetAllocator, "allocate">;
  eventRegistry?: IEventRegistry;
  milestoneEmitter?: IMilestoneEmitter;
  context?: IApplicationContext;
  db?: IDatabaseService;
  gateEvaluator?: IGateEvaluator;
  config?: Config;
  /** Canonical dynamic handler map from buildDynamicHandlers(context, permissions). */
  dynamicHandlers?: Map<McpToolName, ToolHandler>;
  /** @deprecated Use dynamicHandlers with buildDynamicHandlers() output instead. */
  mcpHandlers?: ToolHandler[];
  /** Optional step durability store for persisting execution records. No-op when omitted. */
  stepDurabilityStore?: IStepDurabilityStore;
  /** Optional replay policy for deciding whether a prior step result can be reused. No-op (deny all) when omitted. */
  stepReplayPolicy?: IStepReplayPolicy;
  /** Optional checkpoint service override for testing. */
  checkpointService?: IFlowCheckpointService;
  /** Model preset name for dynamic steps, such as "small" or "large". */
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
  /** SQLite launch source of truth for session_delegate_cycle claims. */
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
  skipCode?: FlowStepSkipCode;
  /** Execution result if successful */
  result?: IAgentExecutionResult;
  /** Error message if failed */
  error?: string;
  /** Terminal control error code retained through wave processing. */
  errorCode?: string;
  /** Allowlisted provider failure reason, when failure occurred before a model call. */
  providerReasonCode?: string;
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

export interface IStepNamespaceWrites {
  writes: IFlowNamespaceWrite[];
  stepOutput: string;
}

/** The original flow request, passed unchanged through every internal step method. */
export type IFlowOriginalRequest = {
  userPrompt: string;
  traceId?: string;
  requestId?: string;
  bindingSnapshot?: IBindingRunSnapshot;
  flowId?: string;
  requestAnalysis?: IRequestAnalysis;
  portal?: string;
  /** Trusted canonical request path beneath Workspace/Requests.
   *  It lets the run claim an operator per-run binding file.
   *  It is never taken from request-file content. */
  requestPath?: string;
  /** SHA-256 of the exact request bytes the daemon read from `requestPath`. */
  requestSha256?: string;
  /** The portal's configured `target_path` verbatim. */
  executionRoot?: string;
  /** Worktree-relative `.exa/PlanContext/<slug>.md` pointer. */
  planContextRef?: string;
  /** Run-local fixture recording allocator, present only for an opted-in scenario run. */
  recording?: IFlowRecordingContext;
};

/** Shared context for step-level execution (reduces parameter count across step methods). */
export interface IStepContext {
  flowRunId: string;
  step: IFlowStep;
  flow: IFlow;
  request: IFlowOriginalRequest;
  stepResults: Map<string, IStepResult>;
  startedAt: Date;
  loopIteration?: number;
  gateFeedback?: string;
}

// unslop-ignore-next-line unused-type
export type TFormatStepSuccessField = "flowRunId" | "step" | "request" | "startedAt";

export type IFormatStepSuccessContext = Pick<IStepContext, TFormatStepSuccessField>;

export interface IStepRecoveryMetadata {
  wasRetried?: boolean;
  retryCount?: number;
  fallbackUsed?: boolean;
  compensationRan?: boolean;
}

// unslop-ignore-next-line unused-type
export interface IFlowEventRequestContext {
  traceId?: string;
  requestId?: string;
}

export interface IFlowEventLogBase extends IFlowEventRequestContext {
  flowId: string;
}

// unslop-ignore-next-line unused-type
export interface IFlowProviderTokenStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// unslop-ignore-next-line unused-type
export interface IFlowWaveErrorPayload {
  stepId: string;
  error: string;
}

export interface IFlowEventPayloadMap {
  [DomainEventType.FlowLoopIteration]: IFlowLoopIterationEventPayload;
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
    reasonCode?: string;
  };
  [DomainEventType.FlowStepQueued]: IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    agentRole: string;
    dependencies: string[];
    inputSource: IFlowStep["input"]["source"];
  };
  [DomainEventType.FlowStepStarted]: IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    agentRole: string;
    /** The step's declared strategy, when set. */
    strategy?: string;
  };
  "flow.step.retry": IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    agentRole: string;
    attempt: number;
    maxRetries: number;
    error: string;
  };
  "flow.step.fallback": IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    agentRole: string;
    fallbackStepId: string;
    fallbackAgentRole: string;
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
    condition?: string;
    skipCode?: IStepResult["skipCode"];
    reason: string;
  };
  [DomainEventType.FlowGateEvaluated]: IFlowGateEvaluatedEventPayload;
  [DomainEventType.FlowBranchDecided]: IFlowBranchDecidedEventPayload;
  [DomainEventType.FlowGateCriteriaNoAnalysis]: IFlowEventRequestContext & { flowRunId: string; stepId: string };
  [DomainEventType.FlowStepCompleted]: IFlowEventRequestContext & {
    flowRunId: string;
    stepId: string;
    agentRole: string;
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
    agentRole: string;
    error: string;
    errorType: string;
    duration: number;
    providerReasonCode?: string;
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
  /** Absolute path to the persisted namespace artifact. */
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

// unslop-ignore-next-line unused-type
/** How far a flow has progressed, for a milestone summary. */
export interface IFlowProgressHint {
  stepsCompleted?: number;
  stepsTotal?: number;
  currentStepLabel?: string;
}

/** Emits one flow milestone through the configured emitter, when there is one. */
export type EmitFlowMilestone = (
  milestoneType: IExecutionMilestone["milestoneType"],
  traceId: Opt<string, Reason.TraceAbsent>,
  summary: string,
  progressHint?: Opt<IFlowProgressHint, Reason.OptionalContext>,
  requiresAttention?: boolean,
  attentionReason?: Opt<string, Reason.OptionalContext>,
) => Promise<void>;

/** Executes one named flow step with its current result map. */
export type ExecuteFlowStep = (
  flowRunId: string,
  stepId: string,
  flow: IFlow,
  request: IFlowOriginalRequest,
  stepResults: Map<string, IStepResult>,
  repeat?: Opt<{ iteration: number; feedback?: string }, Reason.OptionalContext>,
) => Promise<IStepResult>;
