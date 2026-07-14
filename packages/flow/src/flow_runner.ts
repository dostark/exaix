/**
 * @module FlowRunner
 * @path packages/flow/src/flow_runner.ts
 * @description Core orchestrator for multi-agent flow execution.
 * @architectural-layer Flows
 * @related-files [packages/flow/mod.ts, packages/request/src/router.ts]
 */

import type { IFlow, IFlowNamespaceWrite, IFlowStep, IGateEvaluate, IParallelMergeMode } from "@exaix/schemas/flow.ts";
import { encodeHex } from "@std/encoding/hex";
import { DependencyResolver } from "@exaix/flow";
import type { IAgentExecutionResult } from "@exaix/execution";
import { ConditionEvaluator } from "./condition_evaluator.ts";
import { mergeAsContext } from "@exaix/core/func";
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
import type { IMcpClient } from "@exaix/mcp";
import type { IToolManifestResolver } from "@exaix/core/types";
import { LlmClient } from "@exaix/ai/llm_client.ts";
import type { ModelResolver } from "@exaix/ai";
import type { IModelIntent } from "@exaix/schemas";
import { mapPresetToSize } from "./preset_mapper.ts";
import type { ToolHandler } from "@exaix/mcp/server";
import type { McpToolName } from "@exaix/mcp";
import type { Config } from "@exaix/schemas/config.ts";
import { DEFAULT_TIMEOUT_MS } from "@exaix/core";
import { RetryPolicy } from "@exaix/core/request";
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
import { UnknownFlowStepError } from "./step_handlers/flow_step_error.ts";
import type { IStepExecutionContext } from "./step_handlers/step_handler.ts";
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
  FLOW_EVENT_PARALLEL_GROUP_COMPLETED,
  FLOW_EVENT_PARALLEL_GROUP_MERGE_FAILED,
  FLOW_EVENT_PARALLEL_GROUP_STARTED,
  FLOW_EVENT_STEP_COMPENSATED,
  FLOW_EVENT_STEP_COMPENSATION_FAILED,
  FLOW_EVENT_STEP_FALLBACK,
  FLOW_EVENT_STEP_RETRY,
  FLOW_EVENT_STEP_SKIPPED,
  FLOW_EVENT_STEP_SKIPPED_BY_REUSE,
  FLOW_EVENT_VALIDATION_FAILED,
  MILESTONE_APPROVAL_GATE_RESOLVED,
  MILESTONE_FLOW_COMPLETED,
  MILESTONE_FLOW_FAILED,
  MILESTONE_FLOW_STARTED,
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
  /** Skills to apply for this step execution (Phase 17) */
  skills?: string[];
  /** Structured request analysis from Step 11 */
  requestAnalysis?: IRequestAnalysis;
  /** Resolved namespace reads for this step, keyed by binding key (Phase 64) */
  sharedNamespace?: Record<string, string>;
  /** Deterministic summaries for requested parallel groups (Phase 65) */
  parallelGroupResults?: Record<string, IParallelGroupSummary>;
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
  /**
   * Canonical dynamic handler map from buildDynamicHandlers(context, permissions).
   * Takes precedence over mcpHandlers. Using this ensures only manifest-approved
   * dynamic tools are available to DynamicStepExecutor.
   */
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
  /**
   * Model preset name for dynamic steps (e.g. "small", "medium", "large").
   * When omitted, LlmClient defaults to "default" (models.default).
   */
  dynamicModel?: string;
  /** Optional ModelResolver for resolving dynamicModel presets to provider:model. */
  modelResolver?: ModelResolver;
  /** Optional Phase 118 HITL policy evaluator for per-action governance. No-op (Solo) when omitted. */
  hitlPolicyEvaluator?: IHitlPolicyEvaluator;
  /** Dynamic-mode tool sets from the MCP manifest. Required for dynamic step execution. */
  dynamicModeTools?: ReadonlySet<string>;
  dynamicModeApprovalTools?: ReadonlySet<string>;
  /** Pre-built MCP client for dynamic step execution. Overrides dynamicHandlers/mcpHandlers when provided. */
  mcpClient?: IMcpClient & IToolManifestResolver;
  /** Pre-built confirmation interceptor for dynamic step execution. Created internally when omitted. */
  confirmationInterceptor?: IToolConfirmationInterceptor;
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
  /** Deferred namespace writes flushed after the wave settles (Phase 64). */
  namespaceWrites?: IStepNamespaceWrites;
  /** When set, the step created a durable wait state that must be resolved before the flow can continue. */
  waitStateId?: string;
}

interface IStepNamespaceWrites {
  writes: IFlowNamespaceWrite[];
  stepOutput: string;
}

interface IWaveProcessingOutcome {
  successCount: number;
  failureCount: number;
  failed: boolean;
  waveError?: { stepId: string; error: Error | string };
}

/** Shared context for wave-level processing (reduces parameter count across wave methods). */
interface IWaveContext {
  flow: IFlow;
  request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis };
  flowRunId: string;
  flowContentHash: string;
  stepResults: Map<string, IStepResult>;
  failFast: boolean;
}

/** Shared context for step-level execution (reduces parameter count across step methods). */
interface IStepContext {
  flowRunId: string;
  step: IFlowStep;
  flow: IFlow;
  request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis };
  stepResults: Map<string, IStepResult>;
  startedAt: Date;
}

type IFormatStepSuccessContext = Pick<IStepContext, "flowRunId" | "step" | "request" | "startedAt">;
type IBuildMergeOutputContext = Pick<IStepContext, "flowRunId" | "step" | "flow">;

interface IWaveExecutionUnit {
  stepIds: string[];
  groupId?: string;
}

interface IWaveExecutionResult {
  stepIds: string[];
  results: PromiseSettledResult<IStepResult>[];
}

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

interface IFlowEventLogBase extends IFlowEventRequestContext {
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
  /** Absolute path to the persisted namespace artifact; undefined when namespace is disabled (Phase 64) */
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

/**
 * Convert an IGateEvaluate (YAML-facing gate config) to a GateConfig (evaluator
 * input), preserving all fields including `includeRequestCriteria`.
 */
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

/**
 * FlowRunner - Orchestrates multi-agent flow execution
 * Implements Step 7.4 of the Exaix Implementation Plan
 */
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

  private createNoOpDurabilityStore(): IStepDurabilityStore {
    return {
      save: (_record: IStepExecutionRecord) => Promise.resolve(),
      findReplayCandidate: () => Promise.resolve(null),
      invalidate: (_recordId: string, _reason: string) => Promise.resolve(),
    };
  }

  private isPromiseRejectedResult(result: PromiseSettledResult<IStepResult>): result is PromiseRejectedResult {
    return result.status === "rejected";
  }

  private isPromiseFulfilledResult(
    result: PromiseSettledResult<IStepResult>,
  ): result is PromiseFulfilledResult<IStepResult> {
    return result.status === "fulfilled";
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
    this.initCoreServices();

    this.stepDurabilityStore = options.stepDurabilityStore ?? this.createNoOpDurabilityStore();
    this.stepReplayPolicy = options.stepReplayPolicy ?? new DefaultStepReplayPolicy();
    this.waitStateService = options.waitStateService;
    this.modelResolver = options.modelResolver;
    this.checkpointCoordinator = new FlowCheckpointCoordinator({
      checkpointService: this.checkpointService,
      stepDurabilityStore: this.stepDurabilityStore,
      eventLogger: this.eventLogger,
    });
    this.namespaceCoordinator = new FlowNamespaceCoordinator({
      namespaceService: this.namespaceService,
      eventLogger: this.eventLogger,
    });

    this.registerEventPublisher(options);

    const config = this.config;
    const db = this.db;
    const dynamicHandlers = options.dynamicHandlers;
    const mcpHandlers = options.mcpHandlers;
    this.initDynamicTools(config, db, dynamicHandlers, mcpHandlers, options);

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
    const hasDynamicTools = dynamicHandlers !== undefined || mcpHandlers !== undefined;
    if (!config || !hasDynamicTools || !this.eventLogger) return;

    const activityJournal = new ActivityJournal(this.eventLogger);
    this.mcpClient = options.mcpClient;

    if (this.modelResolver) return;

    const llmClient = new LlmClient(config, undefined, this.options.dynamicModel);
    const confirmationInterceptor = options.confirmationInterceptor;
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

  /**
   * Lazily initialise the dynamic step executor when a modelResolver is configured.
   * Called at the start of execute() — not in the constructor — because model
   * resolution is async.
   */
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
    );
  }

  /**
   * Expose the step-handler registry for external extension.
   * Paid-edition handlers register additional step types here at bootstrap.
   */
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
    },
  ): Promise<IFlowResult> {
    const flowRunId = crypto.randomUUID();
    const startedAt = new Date();
    const flowContentHash = await this.computeFlowContentHash(flow);

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
      await this.executeWaves(flow, request, flowRunId, flowContentHash, stepResults);

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
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
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

    const fallbackCycle = this.findCyclicFallbackChain(flow);
    if (fallbackCycle) {
      const errorMessage = `Cyclic fallback chain detected: ${fallbackCycle.join(" -> ")}`;
      await this.eventLogger.log(FLOW_EVENT_VALIDATION_FAILED, {
        error: errorMessage,
        ...this.getIFlowLogBase(flow, request),
      });
      throw new FlowExecutionError(errorMessage, flowRunId);
    }

    const parallelValidationError = this.validateParallelGroups(flow);
    if (parallelValidationError) {
      await this.eventLogger.log(FLOW_EVENT_VALIDATION_FAILED, {
        error: parallelValidationError,
        ...this.getIFlowLogBase(flow, request),
      });
      throw new FlowExecutionError(parallelValidationError, flowRunId);
    }

    // Log flow validation success
    await this.eventLogger.log(DomainEventType.FlowValidated, {
      maxParallelism: flow.settings?.maxParallelism ?? 3,
      failFast: flow.settings?.failFast ?? true,
      ...this.getIFlowLogBase(flow, request, { includeStepCount: true }),
    });
  }

  private findCyclicFallbackChain(flow: IFlow): string[] | null {
    const stepsById = new Map(flow.steps.map((step) => [step.id, step]));

    for (const startStep of flow.steps) {
      const path: string[] = [];
      const seenAt = new Map<string, number>();
      let currentStep: IFlowStep | undefined = startStep;

      while (currentStep?.onError?.action === FlowStepOnErrorAction.FALLBACK && currentStep.onError.fallbackStep) {
        seenAt.set(currentStep.id, path.length);
        path.push(currentStep.id);

        const nextStep = stepsById.get(currentStep.onError.fallbackStep);
        if (!nextStep) {
          break;
        }

        const cycleStartIndex = seenAt.get(nextStep.id);
        if (cycleStartIndex !== undefined) {
          return [...path.slice(cycleStartIndex), nextStep.id];
        }

        currentStep = nextStep;
      }
    }

    return null;
  }

  private validateParallelGroups(flow: IFlow): string | null {
    const stepsById = new Map(flow.steps.map((step) => [step.id, step]));
    const groupMembers = new Map<string, Set<string>>();

    for (const step of flow.steps) {
      const groupId = step.parallel?.group;
      if (!groupId) {
        continue;
      }

      const members = groupMembers.get(groupId) ?? new Set<string>();
      members.add(step.id);
      groupMembers.set(groupId, members);
    }

    for (const step of flow.steps) {
      for (const groupId of step.mergeFromGroups ?? []) {
        if (!groupMembers.has(groupId)) {
          return `Step '${step.id}' references unknown parallel group '${groupId}'`;
        }
      }

      const order = step.parallel?.order;
      const groupId = step.parallel?.group;
      if (groupId && order) {
        const members = groupMembers.get(groupId) ?? new Set<string>();
        for (const orderedStepId of order) {
          if (!members.has(orderedStepId)) {
            return `Parallel group '${groupId}' order entry '${orderedStepId}' does not match any group member step ID`;
          }
        }
      }

      for (const dependencyId of step.dependsOn ?? []) {
        const dependency = stepsById.get(dependencyId);
        if (!dependency?.parallel?.group || !step.parallel?.group) {
          continue;
        }

        if (dependency.parallel.group !== step.parallel.group) {
          return `Steps '${dependency.id}' and '${step.id}' cannot declare different parallel groups across a dependency edge`;
        }
      }
    }

    return null;
  }

  /**
   * Execute waves sequentially with parallel step execution
   */
  private async executeWaves(
    flow: IFlow,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    flowRunId: string,
    flowContentHash: string,
    stepResults: Map<string, IStepResult>,
  ): Promise<void> {
    // Log flow start
    await this.eventLogger.log(DomainEventType.FlowStarted, {
      flowRunId,
      maxParallelism: flow.settings?.maxParallelism ?? 3,
      failFast: flow.settings?.failFast ?? true,
      ...this.getIFlowLogBase(flow, request, { includeStepCount: true }),
    });

    await this.emitMilestone(MILESTONE_FLOW_STARTED, request.traceId, `Flow ${flow.id} started`, {
      stepsCompleted: 0,
      stepsTotal: flow.steps.length,
    });

    // Resolve dependency graph
    await this.eventLogger.log(DomainEventType.FlowDependenciesResolving, {
      flowRunId,
      ...this.getIFlowLogBase(flow, request),
    });

    const resolver = new DependencyResolver(flow.steps);
    const waves = resolver.groupIntoWaves();

    await this.eventLogger.log(DomainEventType.FlowDependenciesResolved, {
      flowRunId,
      waveCount: waves.length,
      totalSteps: flow.steps.length,
      ...this.getIFlowLogBase(flow, request),
    });

    const failFast = flow.settings?.failFast ?? true;

    // Execute waves sequentially
    for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
      const wave = waves[waveIndex];
      await this.executeWave({ flow, request, flowRunId, flowContentHash, stepResults, failFast }, wave, waveIndex);

      // If any step created a wait state in this wave, break the loop so the flow
      // can be paused and resumed later. Checkpoint is saved so state is preserved.
      const pendingStepResults = [...stepResults.values()].filter((r) => r.waitStateId);
      const hasPendingWait = pendingStepResults.length > 0;
      if (hasPendingWait) {
        const waitPayload = {
          flowRunId,
          waitStateId: pendingStepResults[0].waitStateId!,
          traceId: request.traceId ?? "",
          stepIds: pendingStepResults.map((r) => r.stepId),
          ...this.getIFlowLogBase(flow, request),
        };
        if (this.eventRegistry) {
          await this.eventRegistry.emit("flow_runner", DomainEventType.WaitStateResolved, waitPayload);
        } else {
          await this.eventLogger.log(DomainEventType.WaitStateResolved, waitPayload);
        }
        await this.emitMilestone(
          MILESTONE_APPROVAL_GATE_RESOLVED,
          request.traceId,
          `Approval gate resolved for flow ${flow.id}`,
        );
        await this.checkpointCoordinator.saveCheckpointIfEnabled(
          flow,
          request,
          flowRunId,
          flowContentHash,
          stepResults,
        );
        break;
      }
    }
  }

  /**
   * Execute a single wave of steps in parallel
   */
  private async executeWave(
    ctx: IWaveContext,
    wave: string[],
    waveIndex: number,
  ): Promise<void> {
    const waveNumber = waveIndex + 1;

    await this.logWaveStart(ctx.flowRunId, ctx.request, waveNumber, wave);

    const pendingStepIds = wave.filter((stepId) => !ctx.stepResults.has(stepId));

    if (pendingStepIds.length !== wave.length) {
      await this.logSkippedWaveSteps(ctx.flowRunId, ctx.request, waveNumber, wave, ctx.stepResults);
    }

    if (pendingStepIds.length === 0) {
      await this.logCompletedEmptyWave(ctx.flowRunId, ctx.request, waveNumber, wave.length);
      return;
    }

    const waveResults = await this.collectWaveResults(
      ctx.flow,
      ctx.request,
      ctx.flowRunId,
      pendingStepIds,
      ctx.stepResults,
      waveNumber,
    );

    const waveFailed = await this.processWaveResults(
      ctx,
      pendingStepIds,
      waveNumber,
      waveResults,
    );

    this.throwIfWaveCannotContinue(ctx.flowRunId, pendingStepIds, waveResults, waveFailed, ctx.failFast);
  }

  private async logWaveStart(
    flowRunId: string,
    request: { traceId?: string; requestId?: string },
    waveNumber: number,
    wave: string[],
  ): Promise<void> {
    await this.eventLogger.log(DomainEventType.FlowWaveStarted, {
      flowRunId,
      waveNumber,
      waveSize: wave.length,
      stepIds: wave,
      traceId: request.traceId,
      requestId: request.requestId,
    });
  }

  private async logSkippedWaveSteps(
    flowRunId: string,
    request: { traceId?: string; requestId?: string },
    waveNumber: number,
    wave: string[],
    stepResults: Map<string, IStepResult>,
  ): Promise<void> {
    await this.eventLogger.log(DomainEventType.FlowWaveResumeSkipped, {
      flowRunId,
      waveNumber,
      skippedStepIds: wave.filter((stepId) => stepResults.has(stepId)),
      traceId: request.traceId,
      requestId: request.requestId,
    });
  }

  private async logCompletedEmptyWave(
    flowRunId: string,
    request: { traceId?: string; requestId?: string },
    waveNumber: number,
    waveSize: number,
  ): Promise<void> {
    await this.eventLogger.log(DomainEventType.FlowWaveCompleted, {
      flowRunId,
      waveNumber,
      waveSize,
      successCount: waveSize,
      failureCount: 0,
      failed: false,
      traceId: request.traceId,
      requestId: request.requestId,
    });
  }

  private async collectWaveResults(
    flow: IFlow,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    flowRunId: string,
    pendingStepIds: string[],
    stepResults: Map<string, IStepResult>,
    waveNumber: number,
  ): Promise<PromiseSettledResult<IStepResult>[]> {
    const executionUnits = this.buildWaveExecutionUnits(flow, pendingStepIds);
    const executionResults = await Promise.all(
      executionUnits.map((unit) => this.executeWaveUnit(unit, flowRunId, flow, request, stepResults, waveNumber)),
    );
    const waveResultsByStepId = new Map<string, PromiseSettledResult<IStepResult>>();

    for (const executionResult of executionResults) {
      for (let index = 0; index < executionResult.stepIds.length; index++) {
        waveResultsByStepId.set(executionResult.stepIds[index], executionResult.results[index]);
      }
    }

    return pendingStepIds.map((stepId) => {
      const waveResult = waveResultsByStepId.get(stepId);
      if (!waveResult) {
        throw new FlowExecutionError(`Missing execution result for step ${stepId}`, flowRunId);
      }
      return waveResult;
    });
  }

  private throwIfWaveCannotContinue(
    flowRunId: string,
    pendingStepIds: string[],
    waveResults: PromiseSettledResult<IStepResult>[],
    waveFailed: boolean,
    failFast: boolean,
  ): void {
    const abortResult = waveResults.find(
      (result): result is PromiseRejectedResult => {
        return this.isPromiseRejectedResult(result) && result.reason instanceof FlowAbortError;
      },
    );

    if (abortResult) {
      throw abortResult.reason;
    }

    if (!waveFailed || !failFast) {
      return;
    }

    const failedStepIndex = pendingStepIds.findIndex((_stepId, index) => {
      const result = waveResults[index];
      return this.isPromiseRejectedResult(result) ||
        (this.isPromiseFulfilledResult(result) && !result.value.success);
    });
    const failedStepId = pendingStepIds[failedStepIndex];
    const failedResult = waveResults[failedStepIndex];
    const errorMessage = this.getWaveFailureMessage(failedResult);
    throw new FlowExecutionError(`Step ${failedStepId} failed: ${errorMessage}`, flowRunId);
  }

  private getWaveFailureMessage(failedResult: PromiseSettledResult<IStepResult>): string {
    if (this.isPromiseFulfilledResult(failedResult)) {
      return failedResult.value.error || DEFAULT_UNKNOWN_ERROR_MESSAGE;
    }

    if (this.isPromiseRejectedResult(failedResult) && failedResult.reason instanceof Error) {
      return failedResult.reason.message;
    }

    return String((failedResult as PromiseRejectedResult).reason ?? DEFAULT_UNKNOWN_ERROR_MESSAGE);
  }

  private buildWaveExecutionUnits(flow: IFlow, pendingStepIds: string[]): IWaveExecutionUnit[] {
    const stepsById = new Map(flow.steps.map((step) => [step.id, step]));
    const units: IWaveExecutionUnit[] = [];
    const groupedMembers = new Map<string, string[]>();
    const groupOrder: string[] = [];

    for (const stepId of pendingStepIds) {
      const step = stepsById.get(stepId);
      const groupId = step?.parallel?.group;
      if (!groupId) {
        units.push({ stepIds: [stepId] });
        continue;
      }

      const members = groupedMembers.get(groupId);
      if (members) {
        members.push(stepId);
        continue;
      }

      groupedMembers.set(groupId, [stepId]);
      groupOrder.push(groupId);
    }

    for (const groupId of groupOrder) {
      const members = groupedMembers.get(groupId) ?? [];
      if (members.length <= 1) {
        units.push({ stepIds: members });
        continue;
      }
      units.push({ stepIds: members, groupId });
    }

    return units;
  }

  private async executeWaveUnit(
    unit: IWaveExecutionUnit,
    flowRunId: string,
    flow: IFlow,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    stepResults: Map<string, IStepResult>,
    waveNumber: number,
  ): Promise<IWaveExecutionResult> {
    if (!unit.groupId) {
      const result = await Promise.allSettled([
        this.executeStepSafe(flowRunId, unit.stepIds[0], flow, request, stepResults),
      ]);
      return { stepIds: unit.stepIds, results: result };
    }

    const groupStartedAt = performance.now();

    await this.eventLogger.log(FLOW_EVENT_PARALLEL_GROUP_STARTED, {
      flowRunId,
      waveNumber,
      groupId: unit.groupId,
      stepIds: unit.stepIds,
      startedAt: groupStartedAt,
      isoStartedAt: new Date().toISOString(),
      traceId: request.traceId,
      requestId: request.requestId,
    });

    const groupStep = flow.steps.find((s) => s.parallel?.group === unit.groupId);
    const groupTimeoutMs = groupStep?.parallel?.timeout_ms;
    const continueOnError = groupStep?.parallel?.continue_on_error ?? false;

    const executionPromise = Promise.allSettled(
      unit.stepIds.map((stepId) => this.executeStepSafe(flowRunId, stepId, flow, request, stepResults)),
    );

    const results = groupTimeoutMs
      ? await Promise.race([
        executionPromise,
        new Promise<PromiseSettledResult<IStepResult>[]>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Parallel group '${unit.groupId}' timed out after ${groupTimeoutMs}ms`)),
            groupTimeoutMs,
          )
        ),
      ])
      : await executionPromise;

    const processed = continueOnError
      ? results.map((result) => {
        if (this.isPromiseFulfilledResult(result) && !result.value.success) {
          return {
            ...result,
            value: { ...result.value, success: true, error: undefined },
          } as PromiseFulfilledResult<IStepResult>;
        }
        return result;
      })
      : results;

    const successCount = processed.filter((result) => this.isPromiseFulfilledResult(result) && result.value.success)
      .length;
    const failureCount = processed.length - successCount;

    await this.eventLogger.log(FLOW_EVENT_PARALLEL_GROUP_COMPLETED, {
      flowRunId,
      waveNumber,
      groupId: unit.groupId,
      stepIds: unit.stepIds,
      successCount,
      failureCount,
      failed: failureCount > 0,
      duration: performance.now() - groupStartedAt,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    return { stepIds: unit.stepIds, results: processed };
  }

  /**
   * Process results from a completed wave
   */
  private async processWaveResults(
    ctx: IWaveContext,
    wave: string[],
    waveNumber: number,
    waveResults: PromiseSettledResult<IStepResult>[],
  ): Promise<boolean> {
    let waveFailed = false;
    let waveSuccessCount = 0;
    let waveFailureCount = 0;
    const waveErrors: Array<{ stepId: string; error: Error | string }> = [];
    const namespaceId = this.namespaceCoordinator.getNamespaceId(ctx.request, ctx.flowRunId);

    for (let i = 0; i < wave.length; i++) {
      const outcome = await this.processWaveResultEntry(
        ctx,
        wave[i],
        waveNumber,
        waveResults[i],
        namespaceId,
      );

      waveSuccessCount += outcome.successCount;
      waveFailureCount += outcome.failureCount;
      waveFailed = waveFailed || outcome.failed;
      if (outcome.waveError) {
        waveErrors.push(outcome.waveError);
      }
    }

    // Log wave completion
    await this.eventLogger.log(DomainEventType.FlowWaveCompleted, {
      flowRunId: ctx.flowRunId,
      waveNumber,
      waveSize: wave.length,
      successCount: waveSuccessCount,
      failureCount: waveFailureCount,
      failed: waveFailed,
      traceId: ctx.request.traceId,
      requestId: ctx.request.requestId,
    });

    // Log any wave-level errors
    if (waveErrors.length > 0) {
      await this.eventLogger.log(DomainEventType.FlowWaveErrors, {
        flowRunId: ctx.flowRunId,
        waveNumber,
        errorCount: waveErrors.length,
        errors: waveErrors.map(({ stepId, error }) => ({
          stepId,
          error: error instanceof Error ? error.message : String(error),
        })),
        traceId: ctx.request.traceId,
        requestId: ctx.request.requestId,
      });
    }

    return waveFailed;
  }

  private async processWaveResultEntry(
    ctx: IWaveContext,
    stepId: string,
    waveNumber: number,
    promiseResult: PromiseSettledResult<IStepResult>,
    namespaceId: string,
  ): Promise<IWaveProcessingOutcome> {
    try {
      if (this.isPromiseFulfilledResult(promiseResult)) {
        return await this.handleFulfilledWaveResult(
          ctx,
          stepId,
          waveNumber,
          promiseResult.value,
          namespaceId,
        );
      }

      return this.handleRejectedWaveResult(stepId, waveNumber, promiseResult, ctx.stepResults, ctx.failFast);
    } catch (processingError) {
      return await this.handleWaveProcessingError(
        ctx.flowRunId,
        ctx.request,
        stepId,
        processingError,
        ctx.stepResults,
        ctx.failFast,
      );
    }
  }

  private async handleFulfilledWaveResult(
    ctx: IWaveContext,
    stepId: string,
    waveNumber: number,
    promiseValue: IStepResult,
    namespaceId: string,
  ): Promise<IWaveProcessingOutcome> {
    const result = {
      ...promiseValue,
      waveIndex: waveNumber,
    } satisfies IStepResult;
    ctx.stepResults.set(stepId, result);

    if (!result.success) {
      return { successCount: 0, failureCount: 1, failed: ctx.failFast };
    }

    await this.namespaceCoordinator.persistWaveNamespaceWrites(
      result,
      ctx.request,
      stepId,
      namespaceId,
      ctx.flow.namespace?.enabled === true,
    );
    await this.checkpointCoordinator.saveCheckpointIfEnabled(
      ctx.flow,
      ctx.request,
      ctx.flowRunId,
      ctx.flowContentHash,
      ctx.stepResults,
    );

    return { successCount: 1, failureCount: 0, failed: false };
  }

  private handleRejectedWaveResult(
    stepId: string,
    waveNumber: number,
    promiseResult: PromiseRejectedResult,
    stepResults: Map<string, IStepResult>,
    failFast: boolean,
  ): IWaveProcessingOutcome {
    const error: Error | string = promiseResult.reason instanceof Error
      ? promiseResult.reason
      : String(promiseResult.reason);
    const abortError = promiseResult.reason instanceof FlowAbortError ? promiseResult.reason : null;
    const errorIStepResult: IStepResult = abortError?.failureResult ?? {
      stepId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: 0,
      startedAt: new Date(),
      completedAt: new Date(),
      waveIndex: waveNumber,
    };

    if (abortError?.failureResult) {
      errorIStepResult.waveIndex = waveNumber;
    }

    stepResults.set(stepId, errorIStepResult);
    return {
      successCount: 0,
      failureCount: 1,
      failed: failFast,
      waveError: { stepId, error },
    };
  }

  private async handleWaveProcessingError(
    flowRunId: string,
    request: { traceId?: string; requestId?: string },
    stepId: string,
    processingError: Error | string | unknown,
    stepResults: Map<string, IStepResult>,
    failFast: boolean,
  ): Promise<IWaveProcessingOutcome> {
    const processingErrorMessage = processingError instanceof Error ? processingError.message : String(processingError);
    const previousResult = stepResults.get(stepId);
    if (previousResult?.success) {
      stepResults.set(stepId, {
        ...previousResult,
        success: false,
        result: undefined,
        error: processingErrorMessage,
        namespaceWrites: undefined,
      });
    }

    await this.eventLogger.log(DomainEventType.FlowStepProcessingError, {
      flowRunId,
      stepId,
      error: processingErrorMessage,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    return { successCount: 0, failureCount: 1, failed: failFast };
  }

  /**
   * Aggregate output and create final flow result
   */
  private async aggregateAndFinalize(
    flow: IFlow,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
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
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
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
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
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
        await this.enforceRetryCostBudget(flowRunId, request);

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

        await this.applyRetryBackoff(retryBackoffMs, retryAttempt);

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
      await this.executeCompensatingTransactions(flowRunId, step, flow, request, stepResults);
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
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
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

  private async applyRetryBackoff(backoffMs: number, retryAttempt: number): Promise<void> {
    const retryPolicy = new RetryPolicy({
      initialDelayMs: backoffMs,
      maxDelayMs: DEFAULT_TIMEOUT_MS,
      backoffMultiplier: 2,
      jitterFactor: 0,
    });

    const delayMs = retryPolicy.calculateDelay(retryAttempt);
    if (Deno.env.get("DENO_TEST") !== "1") {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  private async enforceRetryCostBudget(
    flowRunId: string,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
  ): Promise<void> {
    const maxFlowRetryCostUsd = this.config?.max_flow_retry_cost_usd;
    if (!this.db || !request.traceId || !maxFlowRetryCostUsd || maxFlowRetryCostUsd <= 0) {
      return;
    }

    const totalCostUsd = await this.getCumulativeFlowCostUsd(request.traceId);
    if (totalCostUsd > maxFlowRetryCostUsd) {
      throw new FlowExecutionError("Retry budget exceeded", flowRunId);
    }
  }

  private async getCumulativeFlowCostUsd(traceId: string): Promise<number> {
    const tokenEvents = await this.db!.queryActivity({
      traceId,
      actionType: "llm.usage",
    });

    let totalCostUsd = 0;
    for (const event of tokenEvents) {
      try {
        const payload = JSON.parse(event.payload) as Record<string, JSONValue>;
        const rawCost = payload.cost_usd;
        const costUsd = typeof rawCost === "number" ? rawCost : Number(rawCost ?? 0);
        if (Number.isFinite(costUsd)) {
          totalCostUsd += costUsd;
        }
      } catch {
        // Ignore malformed activity rows when calculating the retry budget.
      }
    }

    return totalCostUsd;
  }

  private async executeCompensatingTransactions(
    flowRunId: string,
    failedStep: IFlowStep,
    flow: IFlow,
    request: {
      userPrompt: string;
      traceId?: string;
      requestId?: string;
      requestAnalysis?: IRequestAnalysis;
      portal?: string;
    },
    stepResults: Map<string, IStepResult>,
  ): Promise<void> {
    if (!this.mcpClient) {
      return;
    }

    const completedStepIds = Array.from(stepResults.values())
      .filter((result) => result.success)
      .sort((left, right) => {
        const waveDiff = (right.waveIndex ?? -1) - (left.waveIndex ?? -1);
        if (waveDiff !== 0) {
          return waveDiff;
        }

        const completedAtDiff = right.completedAt.getTime() - left.completedAt.getTime();
        if (completedAtDiff !== 0) {
          return completedAtDiff;
        }

        const leftFlowIndex = flow.steps.findIndex((candidate) => candidate.id === left.stepId);
        const rightFlowIndex = flow.steps.findIndex((candidate) => candidate.id === right.stepId);
        return rightFlowIndex - leftFlowIndex;
      })
      .map((result) => result.stepId);

    for (const completedStepId of completedStepIds) {
      const completedStep = flow.steps.find((candidate) => candidate.id === completedStepId);
      const compensations = completedStep?.onError?.compensate ?? [];

      if (compensations.length > 0) {
        const completedResult = stepResults.get(completedStepId);
        if (completedResult) {
          stepResults.set(completedStepId, {
            ...completedResult,
            compensationRan: true,
          });
        }
      }

      for (const compensation of compensations) {
        const compensationArgs = (compensation.args ?? compensation.params ?? {}) as Record<string, JSONValue>;
        const args: Record<string, JSONValue> = {
          ...(request.portal ? { portal: request.portal } : {}),
          identity_id: completedStep?.identity ?? failedStep.identity,
          ...compensationArgs,
        };

        try {
          const result = await this.mcpClient.callTool(compensation.tool, args);

          await this.eventLogger.log(FLOW_EVENT_STEP_COMPENSATED, {
            flowRunId,
            failedStepId: failedStep.id,
            sourceStepId: completedStepId,
            tool: compensation.tool,
            args,
            success: true,
            result,
            traceId: request.traceId,
            requestId: request.requestId,
          });
        } catch (error) {
          await this.eventLogger.log(FLOW_EVENT_STEP_COMPENSATED, {
            flowRunId,
            failedStepId: failedStep.id,
            sourceStepId: completedStepId,
            tool: compensation.tool,
            args,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            traceId: request.traceId,
            requestId: request.requestId,
          });

          await this.eventLogger.log(FLOW_EVENT_STEP_COMPENSATION_FAILED, {
            flowRunId,
            failedStepId: failedStep.id,
            sourceStepId: completedStepId,
            tool: compensation.tool,
            args,
            error: error instanceof Error ? error.message : String(error),
            traceId: request.traceId,
            requestId: request.requestId,
          });
        }
      }
    }
  }

  /**
   * Evaluate step condition and return skip result if condition fails
   */
  private async evaluateStepCondition(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    stepResults: Map<string, IStepResult>,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
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
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
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
      },
      stepRequest: {
        userPrompt: stepRequest.userPrompt,
        context: stepRequest.context ?? {},
        traceId: stepRequest.traceId,
        requestId: stepRequest.requestId,
        requestAnalysis: stepRequest.requestAnalysis,
        skills: stepRequest.skills,
        sharedNamespace: stepRequest.sharedNamespace,
        parallelGroupResults: stepRequest.parallelGroupResults,
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
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
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
    originalRequest: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
    stepResults: Map<string, IStepResult>,
  ): Promise<IFlowStepRequest> {
    const inputData = this.collectStepInputData(step, originalRequest, stepResults);
    const userPrompt = await this.buildStepUserPrompt(flowRunId, step, originalRequest, inputData);

    // Merge skills: step-level skills override flow-level defaults (Phase 17)
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
      skills,
      requestAnalysis: originalRequest.requestAnalysis,
    };

    const stepRequestWithParallelGroups = this.attachParallelGroupResults(
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
    if (!step.input.from || step.input.from.length === 0) {
      throw new Error(`Step ${step.id} has source "aggregate" but no "from" steps specified`);
    }

    const aggregatedInputs = step.input.from.map((stepId) => this.getStepResultContent(step, stepId, stepResults));
    return aggregatedInputs.length === 1 ? aggregatedInputs[0] : aggregatedInputs.join("\n\n");
  }

  private async buildStepUserPrompt(
    flowRunId: string,
    step: IFlowStep,
    originalRequest: { userPrompt: string; traceId?: string; requestId?: string },
    inputData: string,
  ): Promise<string> {
    if (!step.input.transform) {
      return inputData;
    }

    const transformStart = Date.now();
    const userPrompt = this.stepOutputFormatter.applyTransform(
      inputData,
      step.input.transform as string | ((input: string) => string),
      step.input.transformArgs as JSONValue | undefined,
      originalRequest.userPrompt,
    );

    await this.eventLogger.log(DomainEventType.FlowStepTransformApplied, {
      flowRunId,
      stepId: step.id,
      transformName: typeof step.input.transform === "string" ? step.input.transform : "custom",
      inputSize: inputData.length,
      outputSize: userPrompt.length,
      duration: Date.now() - transformStart,
      traceId: originalRequest.traceId,
      requestId: originalRequest.requestId,
    });

    return userPrompt;
  }

  private attachParallelGroupResults(
    stepRequest: IFlowStepRequest,
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    originalRequest: { traceId?: string; requestId?: string },
    stepResults: Map<string, IStepResult>,
  ): IFlowStepRequest {
    if (!step.mergeFromGroups?.length) {
      return stepRequest;
    }

    const parallelGroupResults = this.buildParallelGroupSummaries(
      flowRunId,
      step,
      flow,
      originalRequest,
      stepResults,
    );

    return { ...stepRequest, parallelGroupResults };
  }

  private buildParallelGroupSummaries(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    originalRequest: { traceId?: string; requestId?: string },
    stepResults: Map<string, IStepResult>,
  ): Record<string, IParallelGroupSummary> {
    const summaries: Record<string, IParallelGroupSummary> = {};

    for (const groupId of step.mergeFromGroups ?? []) {
      summaries[groupId] = this.buildParallelGroupSummary(
        flowRunId,
        step,
        flow,
        groupId,
        originalRequest,
        stepResults,
      );
    }

    return summaries;
  }

  private buildParallelGroupSummary(
    flowRunId: string,
    step: IFlowStep,
    flow: IFlow,
    groupId: string,
    originalRequest: { traceId?: string; requestId?: string },
    stepResults: Map<string, IStepResult>,
  ): IParallelGroupSummary {
    const memberStepIds = this.getParallelGroupMemberStepIds(flow, groupId);
    const mergeMode = this.getParallelGroupMergeMode(step, flow, groupId);
    const memberResults = memberStepIds.map((memberStepId) => {
      const memberResult = stepResults.get(memberStepId);
      if (!memberResult) {
        return this.throwParallelGroupMergeFailure(
          flowRunId,
          step,
          groupId,
          mergeMode,
          originalRequest,
          `Parallel group '${groupId}' is missing result data for step '${memberStepId}'`,
        );
      }
      return { memberStepId, memberResult };
    });

    const completedAt = new Date(
      Math.max(...memberResults.map(({ memberResult }) => memberResult.completedAt.getTime())),
    ).toISOString();
    const successfulResults = memberResults.filter(({ memberResult }) => {
      return memberResult.success && !!memberResult.result?.content;
    });
    const successCount = successfulResults.length;

    const mergedOutput = mergeMode === "manual" ? "" : this.buildAutomaticParallelMergeOutput(
      { flowRunId, step, flow },
      groupId,
      mergeMode,
      originalRequest,
      memberStepIds,
      successfulResults,
    );

    return {
      groupId,
      mergedOutput,
      memberCount: memberStepIds.length,
      successCount,
      completedAt,
    };
  }

  private buildAutomaticParallelMergeOutput(
    ctx: IBuildMergeOutputContext,
    groupId: string,
    mergeMode: IParallelMergeMode,
    originalRequest: { traceId?: string; requestId?: string },
    memberStepIds: string[],
    successfulResults: Array<{ memberStepId: string; memberResult: IStepResult }>,
  ): string {
    const { flowRunId, step, flow } = ctx;
    if (successfulResults.length !== memberStepIds.length) {
      return this.throwParallelGroupMergeFailure(
        flowRunId,
        step,
        groupId,
        mergeMode,
        originalRequest,
        `Parallel group '${groupId}' cannot be merged automatically because not all members produced successful outputs`,
      );
    }

    const orderedStepIds = this.getOrderedParallelGroupMemberStepIds(flow, groupId, memberStepIds);
    const resultsByStepId = new Map(successfulResults.map((entry) => [entry.memberStepId, entry.memberResult]));
    const orderedOutputs = orderedStepIds.map((memberStepId) => {
      const result = resultsByStepId.get(memberStepId);
      if (!result?.result?.content) {
        return this.throwParallelGroupMergeFailure(
          flowRunId,
          step,
          groupId,
          mergeMode,
          originalRequest,
          `Parallel group '${groupId}' is missing merged output content for step '${memberStepId}'`,
        );
      }
      return result.result.content;
    });

    return mergeMode === "concat" ? orderedOutputs.join("\n\n") : mergeAsContext(orderedOutputs);
  }

  private getParallelGroupMemberStepIds(flow: IFlow, groupId: string): string[] {
    return flow.steps
      .filter((candidateStep) => candidateStep.parallel?.group === groupId)
      .map((candidateStep) => candidateStep.id);
  }

  private getParallelGroupMergeMode(
    step: IFlowStep,
    flow: IFlow,
    groupId: string,
  ): IParallelMergeMode {
    const groupStep = flow.steps.find((candidateStep) => candidateStep.parallel?.group === groupId);
    return (step.mergeMode ?? groupStep?.parallel?.mergeMode ?? "all") as IParallelMergeMode;
  }

  private getOrderedParallelGroupMemberStepIds(flow: IFlow, groupId: string, memberStepIds: string[]): string[] {
    const explicitOrder = flow.steps.find((candidateStep) => candidateStep.parallel?.group === groupId)?.parallel
      ?.order;
    if (explicitOrder?.length) {
      return [...explicitOrder];
    }

    return [...memberStepIds].sort((left, right) => left.localeCompare(right));
  }

  private throwParallelGroupMergeFailure(
    flowRunId: string,
    step: IFlowStep,
    groupId: string,
    mergeMode: string,
    originalRequest: { traceId?: string; requestId?: string },
    error: string,
  ): never {
    this.eventLogger.log(FLOW_EVENT_PARALLEL_GROUP_MERGE_FAILED, {
      flowRunId,
      stepId: step.id,
      groupId,
      mergeMode,
      error,
      traceId: originalRequest.traceId,
      requestId: originalRequest.requestId,
    });

    throw new FlowExecutionError(error, flowRunId);
  }

  /**
   * Safe wrapper around `executeStep` to ensure unexpected throws
   * are converted into a `IStepResult` and do not propagate.
   */
  private async executeStepSafe(
    flowRunId: string,
    stepId: string,
    flow: IFlow,
    request: { userPrompt: string; traceId?: string; requestId?: string; requestAnalysis?: IRequestAnalysis },
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
