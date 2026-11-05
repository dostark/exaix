/**
 * @module FlowRunner
 * @path packages/flow/src/flow_runner.ts
 * @description Core orchestrator for multi-agent flow execution. Delegates
 *   parallel-group event emission to WaveOrchestrator and ParallelGroupMergeService.
 * @architectural-layer Flows
 * @related-files [packages/flow/mod.ts, packages/request/src/router.ts]
 * @visible
 */

import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import { FlowRuntimeValidator } from "./flow_runtime_validator.ts";
import { assertFlowCapabilities } from "./flow_capabilities.ts";
import { ParallelGroupMergeService } from "./parallel_group_merge_service.ts";
import { FlowControlStateStore } from "./flow_control_state_store.ts";
import { branchSkipReason } from "./branch_routing.ts";
import { BranchStepHandler } from "./step_handlers/branch_step_handler.ts";
import { RetryBudgetService } from "./retry_budget_service.ts";
import { CompensationService } from "./compensation_service.ts";
import { WaveOrchestrator } from "./wave_orchestrator.ts";
import { StepContentHasher } from "./step_content_hasher.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import { ConditionEvaluator } from "./condition_evaluator.ts";
import type { IDatabaseService } from "@exaix/storage-sqlite";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { IBindingRunSnapshot, IExecutionMilestone, IModelIntent } from "@exaix/schemas";
import { BindingIncompatibleError, BOUND_TARGET_KIND_PROVIDER, STEP_KIND_AGENT } from "@exaix/ai";
import { createGitServiceStub, createProviderStub } from "@exaix/testing/helpers/stub_factories.ts";
import {
  DEFAULT_FLOW_GATE_MAX_EVALUATIONS,
  DEFAULT_UNKNOWN_LABEL,
  FLOW_EVENT_STEP_SKIPPED,
  FLOW_EVENT_STEP_SKIPPED_BY_REUSE,
  FlowStepSkipCode,
  FlowStepType,
  MILESTONE_FLOW_STEP_REPLAYED,
  MILESTONE_FLOW_STEP_SKIPPED,
  MILESTONE_FLOW_STEP_STARTED,
  StepAttemptClass,
  StepExecutionDisposition,
  StepSideEffectClass,
} from "@exaix/core";
import type { IDynamicStepExecutorDependencies } from "./dynamic_step_executor.ts";
import { DynamicStepExecutor } from "./dynamic_step_executor.ts";
import { ActivityJournal } from "./activity_journal.ts";
import { buildConfirmationInterceptor } from "@exaix/tool-runtime";
import type { IMcpClient, McpToolName } from "@exaix/mcp";
import type { IApplicationContext, IGateEvaluator, IToolManifestResolver, Opt, Reason } from "@exaix/core/types";
import { LlmClient } from "@exaix/ai/llm_client.ts";
import type { IModelProvider, ModelResolver } from "@exaix/ai";
import { EFFORT_AUTO, type IModelCallOptions } from "@exaix/schemas";
import { mapPresetToSize } from "./preset_mapper.ts";
import type { ToolHandler } from "@exaix/mcp/server";
import type { Config } from "@exaix/schemas/config.ts";
import { FlowStepHandlerRegistry } from "./step_handlers/step_handler_registry.ts";
import { GateStepHandler, type IPendingWaitStateRef } from "./step_handlers/gate_step_handler.ts";
import { AgentStepHandler } from "./step_handlers/agent_step_handler.ts";
import { SessionDelegateCycleStepHandler } from "./step_handlers/session_delegate_cycle_step_handler.ts";
import { type IFlowTraceStore, isUuid } from "./flow_trace_store.ts";
import { createInMemorySessionDelegateCycleClaimStore } from "@exaix/session/session_delegate_cycle_claim_store.ts";
import { createInMemorySessionDelegateCycleStore } from "@exaix/session/session_delegate_cycle_store.ts";
import { FlowCheckpointService, type IFlowCheckpointService } from "@exaix/flow";
import { ExecutionMemoryStore } from "@exaix/core/execution-memory";
import type { IExecutionMemoryStore } from "@exaix/core/execution-memory";
import { FlowCheckpointCoordinator } from "./flow_checkpoint_coordinator.ts";
import { StepOutputFormatter } from "./step_output_formatter.ts";
import { FlowNamespaceCoordinator } from "./flow_namespace_coordinator.ts";
import { DomainEventType, type IEventRegistry } from "@exaix/core/events";
import type { IStepDurabilityStore, IStepExecutionRecord, IStepReplayPolicy } from "./contracts/step_durability.ts";
import { DefaultStepReplayPolicy } from "./contracts/step_durability.ts";
import { createFlowRecordingContext, type IFlowRecordingContext } from "./contracts/flow_recording_context.ts";
import type {
  IAgentExecutor,
  IFlowEventLogger,
  IFlowOriginalRequest,
  IFlowResult,
  IFlowRunner,
  IFlowRunnerConfig,
  IStepContext,
  IStepNamespaceWrites,
  IStepResult,
} from "./flow_types.ts";
import { FlowTokenUsage } from "./flow_token_usage.ts";
import { FlowStepIo } from "./flow_step_io.ts";
import { getFlowLogBase } from "./flow_log_base.ts";
import { FlowStepGates } from "./flow_step_gates.ts";
import { FlowStepRecovery } from "./flow_step_recovery.ts";
import { FlowAbortError, FlowExecutionError } from "./flow_errors.ts";
import { FlowCompletion } from "./flow_completion.ts";

/** Orchestrates multi-agent flow execution: step dispatch, gate evaluation, aggregation. */
export class FlowRunner implements IFlowRunner {
  private conditionEvaluator: ConditionEvaluator;
  protected dynamicStepExecutor?: DynamicStepExecutor;
  /** DYNAMIC executors keyed by binding fingerprint. One LlmClient serves each distinct bound service fingerprint,
   *  so two differently bound DYNAMIC steps never share a model route. At most one entry grows per fingerprint used in this process. */
  /** One executor per pooled provider instance. A new provider gets a new executor.
   *  An evicted provider takes its executor with it. */
  private readonly dynamicExecutorsByProvider = new WeakMap<IModelProvider, DynamicStepExecutor>();
  private mcpClient?: IMcpClient & IToolManifestResolver;
  private agentExecutor: IAgentExecutor;
  private eventLogger: IFlowEventLogger;
  private db?: IDatabaseService;
  private gateEvaluator?: IGateEvaluator;
  private config?: Config;
  private checkpointService?: IFlowCheckpointService;
  private namespaceService?: IExecutionMemoryStore;
  private stepDurabilityStore: IStepDurabilityStore;
  private stepReplayPolicy: IStepReplayPolicy;
  private readonly controlStateStore = new FlowControlStateStore();
  private checkpointCoordinator!: FlowCheckpointCoordinator;
  private namespaceCoordinator!: FlowNamespaceCoordinator;
  private readonly stepOutputFormatter: StepOutputFormatter = new StepOutputFormatter();
  private readonly stepHandlerRegistry = new FlowStepHandlerRegistry();
  private readonly pendingWaitStateRef: IPendingWaitStateRef = { current: undefined };
  private eventRegistry?: IEventRegistry;
  private modelResolver?: ModelResolver;
  private readonly runtimeValidator = new FlowRuntimeValidator();
  private readonly parallelGroupMergeService: ParallelGroupMergeService;
  private readonly retryBudgetService: RetryBudgetService;
  private compensationService!: CompensationService;
  private waveOrchestrator!: WaveOrchestrator;
  private flowTraceStore?: IFlowTraceStore;
  private readonly stepContentHasher = new StepContentHasher();
  private completion!: FlowCompletion;
  private stepRecovery!: FlowStepRecovery;
  private stepGates!: FlowStepGates;
  private stepIo!: FlowStepIo;
  private tokenUsage!: FlowTokenUsage;

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
    this.modelResolver = options.modelResolver;
    this.flowTraceStore = options.flowTraceStore;
    this.checkpointCoordinator = new FlowCheckpointCoordinator({
      checkpointService: this.checkpointService,
      controlStateStore: this.controlStateStore,
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
        getIFlowLogBase: (flow, request) => getFlowLogBase(flow, request),
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
      }),
    );
    this.initStepCollaborators();
    this.registerAgentStepHandlers();
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
          onReviewedWrites: this.agentExecutor.recordReviewedWrites?.bind(this.agentExecutor),
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

  /** Builds the collaborators that own step input, gates, recovery, token usage and completion. */
  private makeDynamicExecutor(
    llmClient: LlmClient,
    activityJournal: ActivityJournal,
    confirmationInterceptor: IDynamicStepExecutorDependencies["confirmationInterceptor"],
    callOptions: IDynamicStepExecutorDependencies["callOptions"],
  ): DynamicStepExecutor {
    return new DynamicStepExecutor({
      mcpClient: this.mcpClient!,
      llmClient,
      activityJournal,
      confirmationInterceptor,
      milestoneEmitter: this.options.milestoneEmitter,
      hitlPolicyEvaluator: this.options.hitlPolicyEvaluator,
      dynamicModeTools: this.options.dynamicModeTools,
      dynamicModeApprovalTools: this.options.dynamicModeApprovalTools,
      callOptions,
    });
  }

  private llmClientFor(model: Opt<string, Reason.OptionalInput>): LlmClient {
    return new LlmClient(
      this.config,
      undefined,
      model,
      undefined,
      this.options.llmEventLogger,
      this.options.tokenizer,
      this.options.promptBudgetAllocator,
    );
  }

  private registerAgentStepHandlers(): void {
    const agentHandler = new AgentStepHandler({
      agentExecutor: this.agentExecutor,
      dynamicStepExecutor: this.dynamicStepExecutor,
      dynamicExecutorFor: (step, request, stepRequest) => this.dynamicExecutorFor(step, request, stepRequest),
      config: this.config,
    });
    this.stepHandlerRegistry.register(agentHandler);
    this.stepHandlerRegistry.register(new BranchStepHandler(agentHandler, this.eventLogger));
    this.stepHandlerRegistry.registerWithKey(FlowStepType.CONSENSUS, agentHandler);
  }

  private initStepCollaborators(): void {
    this.tokenUsage = new FlowTokenUsage({
      db: this.db,
      eventLogger: this.eventLogger,
    });
    this.stepIo = new FlowStepIo({
      eventLogger: this.eventLogger,
      namespaceCoordinator: this.namespaceCoordinator,
      parallelGroupMergeService: this.parallelGroupMergeService,
      pendingWaitStateRef: this.pendingWaitStateRef,
      stepOutputFormatter: this.stepOutputFormatter,
      emitMilestone: (...args) => this.emitMilestone(...args),
    });
    this.stepGates = new FlowStepGates({
      checkpointCoordinator: this.checkpointCoordinator,
      conditionEvaluator: this.conditionEvaluator,
      controlStateStore: this.controlStateStore,
      eventLogger: this.eventLogger,
      namespaceCoordinator: this.namespaceCoordinator,
      retryBudgetService: this.retryBudgetService,
      stepHandlerRegistry: this.stepHandlerRegistry,
      emitMilestone: (...args) => this.emitMilestone(...args),
      executeStep: (...args) => this.executeStep(...args),
      prepareStepRequest: (...args) => this.stepIo.prepareStepRequest(...args),
    });
    this.stepRecovery = new FlowStepRecovery({
      compensationService: this.compensationService,
      eventLogger: this.eventLogger,
      retryBudgetService: this.retryBudgetService,
      stepIo: this.stepIo,
      executeStep: (...args) => this.executeStep(...args),
      runStepAttempt: (...args) => this.runStepAttempt(...args),
    });
    this.completion = new FlowCompletion({
      agentExecutor: this.agentExecutor,
      eventLogger: this.eventLogger,
      runtimeValidator: this.runtimeValidator,
      checkpointCoordinator: this.checkpointCoordinator,
      db: this.db,
      namespaceCoordinator: this.namespaceCoordinator,
      namespaceService: this.namespaceService,
      stepOutputFormatter: this.stepOutputFormatter,
      tokenUsage: this.tokenUsage,
      emitMilestone: (...args) => this.emitMilestone(...args),
    });
  }

  private initCoreServices(): void {
    if (this.options.checkpointService) {
      this.checkpointService = this.options.checkpointService;
    } else if (this.config) {
      this.checkpointService = new FlowCheckpointService(this.config);
    }
    if (this.config) {
      this.namespaceService = new ExecutionMemoryStore(this.config);
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
      DomainEventType.FlowGateEvaluated,
      DomainEventType.FlowBranchDecided,
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

    const llmClient = this.llmClientFor(this.options.dynamicModel);
    const confirmationInterceptor = options.confirmationInterceptor ??
      (options.context ? buildConfirmationInterceptor(options.context, config, activityJournal) : undefined);
    this.dynamicStepExecutor = this.makeDynamicExecutor(llmClient, activityJournal, confirmationInterceptor, undefined);
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
    const _context = (this.options.context || this.buildFallbackContext(config, db)) as IApplicationContext;
    const llmClient = this.llmClientFor(resolved.model);
    const confirmationInterceptor = this.options.confirmationInterceptor;
    this.dynamicStepExecutor = this.makeDynamicExecutor(
      llmClient,
      activityJournal,
      confirmationInterceptor,
      resolved.options,
    );
    // The agent step handler was registered during construction, before the lazy executor
    // existed, so it captured `dynamicStepExecutor: undefined`. Re-register it now.
    this.registerAgentStepHandlers();
  }

  /** Resolves the DYNAMIC executor for one step. A bound step gets a fingerprint-keyed executor whose LlmClient runs the bound provider
   *  with the snapshot's effort and thinking. An unbound step keeps the shared lazily-resolved executor.
   *  The cache never re-resolves a binding after the run snapshot, because it keys entries by the already fixed fingerprint. */
  private async dynamicExecutorFor(
    step: IFlowStep,
    _request: IFlowOriginalRequest,
    stepRequest: { flowId?: string; bindingSnapshot?: IBindingRunSnapshot },
  ): Promise<DynamicStepExecutor | undefined> {
    if (
      stepRequest.bindingSnapshot && stepRequest.flowId && this.options.bindingService
    ) {
      const bound = await this.options.bindingService.providerFor(stepRequest.bindingSnapshot, {
        flowId: stepRequest.flowId,
        stepId: step.id,
        agentRole: step.agent_role,
        kind: STEP_KIND_AGENT,
        nativeTools: false,
      });
      if (bound) {
        if (bound.kind !== BOUND_TARGET_KIND_PROVIDER) {
          throw new Error(
            `DYNAMIC step "${step.id}" resolved to a cli-delegate session-tool service ${bound.binding.service}`,
          );
        }
        let executor = this.dynamicExecutorsByProvider.get(bound.provider);
        if (!executor) {
          const config = this.config;
          if (!config) {
            throw new Error(`DYNAMIC step "${step.id}" requires config to build a bound executor`);
          }
          const activityJournal = new ActivityJournal(this.eventLogger);
          const llmClient = new LlmClient(
            config,
            bound.provider,
            bound.binding.service_model_id,
            undefined,
            this.options.llmEventLogger,
            this.options.tokenizer,
            this.options.promptBudgetAllocator,
          );
          const callOptions: IModelCallOptions = {
            ...(bound.binding.effort !== undefined && bound.binding.effort !== EFFORT_AUTO
              ? { effort: bound.binding.effort }
              : {}),
            ...(bound.binding.thinking !== undefined && bound.binding.thinking !== EFFORT_AUTO
              ? { thinking: bound.binding.thinking === true }
              : {}),
          };
          executor = new DynamicStepExecutor({
            mcpClient: this.mcpClient!,
            llmClient,
            activityJournal,
            confirmationInterceptor: this.options.confirmationInterceptor,
            milestoneEmitter: this.options.milestoneEmitter,
            hitlPolicyEvaluator: this.options.hitlPolicyEvaluator,
            dynamicModeTools: this.options.dynamicModeTools,
            dynamicModeApprovalTools: this.options.dynamicModeApprovalTools,
            callOptions: Object.keys(callOptions).length > 0 ? callOptions : undefined,
          });
          this.dynamicExecutorsByProvider.set(bound.provider, executor);
        }
        return executor;
      }
    }
    return this.dynamicStepExecutor;
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

  /**
   * Execute a flow with the given request
   */
  async execute(
    flow: IFlow,
    submittedRequest: {
      userPrompt: string;
      traceId?: string;
      requestId?: string;
      requestAnalysis?: IRequestAnalysis;
      portal?: string;
      scenarioId?: string;
      stepId?: string;
      executionRoot?: string;
      planContextRef?: string;
      flowId?: string;
      requestPath?: string;
      requestSha256?: string;
      bindingSnapshot?: IBindingRunSnapshot;
      recordingLanes?: boolean;
    },
  ): Promise<IFlowResult> {
    const flowRunId = crypto.randomUUID();
    const { recordingLanes, ...submitted } = submittedRequest;
    const recording = createFlowRecordingContext({
      scenarioId: submitted.scenarioId,
      stepId: submitted.stepId,
      enabled: recordingLanes === true,
    });
    let request: typeof submitted & { recording?: IFlowRecordingContext } = recording
      ? { ...submitted, recording }
      : submitted;
    const startedAt = new Date();
    const flowContentHash = await this.stepContentHasher.computeFlowContentHash(flow);

    if (flow.steps.some((step) => step.type === FlowStepType.SESSION_DELEGATE_CYCLE)) {
      request = { ...request, traceId: await this.normalizeCycleParentTraceId(request, flowRunId) };
    }

    const stepResults = new Map<string, IStepResult>();
    this.controlStateStore.initialize(
      stepResults,
      this.config?.flow?.max_gate_evaluations ?? DEFAULT_FLOW_GATE_MAX_EVALUATIONS,
      flowContentHash,
      structuredClone({ ai: this.config?.ai ?? null, models: this.config?.models ?? null }),
    );
    let snapshotTraceId: string | undefined;

    try {
      assertFlowCapabilities(
        flow.requires_capabilities ?? [],
        this.options.edition,
        new Set(this.options.installedCapabilities ?? []),
        this.stepHandlerRegistry,
      );
      await this.completion.validateIFlow(flow, request, flowRunId, this.controlStateStore.get(stepResults).ceiling);
      await this.ensureDynamicExecutor(flow, flowRunId);
      const captureBindingSnapshot = async (): Promise<void> => {
        const service = this.options.bindingService;
        if (!service) return;
        const flowDeclaresBindings = flow.steps.some((step) => step.binding !== undefined || step.pin !== undefined);
        if (
          !(flowDeclaresBindings || await service.isActive() ||
            await service.hasRunFile(request.traceId))
        ) return;
        const traceId = request.traceId ?? crypto.randomUUID();
        snapshotTraceId = traceId;
        request = {
          ...request,
          traceId,
          flowId: flow.id,
          bindingSnapshot: await service.snapshotForRun(flow, {
            traceId,
            requestId: request.requestId,
            requestPath: request.requestPath,
            requestSha256: request.requestSha256,
          }),
        };
      };
      await captureBindingSnapshot();
      await this.checkpointCoordinator.loadCheckpointIfAvailable(
        flow,
        request,
        flowRunId,
        flowContentHash,
        stepResults,
      );
      await this.namespaceCoordinator.initializeNamespace(
        this.namespaceCoordinator.getNamespaceId(request, flowRunId),
        flow,
      );
      // Execute waves and aggregate results
      await this.waveOrchestrator.executeWaves(flow, request, flowRunId, flowContentHash, stepResults);

      // If any step entered a wait state, return early without aggregating — the flow
      // will resume when an operator resolves the wait state externally.
      const waitingResult = (): IFlowResult | null => {
        const waitingSteps = [...stepResults.values()].filter((r) => r.waitStateId);
        if (waitingSteps.length === 0) return null;
        return {
          flowRunId,
          success: true,
          stepResults,
          output: "",
          duration: Math.max(0, new Date().getTime() - startedAt.getTime()),
          waiting: true,
          waitStateId: waitingSteps[0].waitStateId,
        } as IFlowResult;
      };
      const waiting = waitingResult();
      if (waiting) return waiting;

      // Aggregate output and finalize
      return await this.completion.aggregateAndFinalize(flow, request, flowRunId, stepResults, startedAt);
    } catch (error) {
      if (error instanceof BindingIncompatibleError) {
        await this.eventLogger.log("flow.failed", {
          flowRunId,
          flowId: flow.id,
          error: error.message,
          errorType: error.name,
          duration: Math.max(0, Date.now() - startedAt.getTime()),
          stepsAttempted: 0,
          successfulSteps: 0,
          failedSteps: 0,
          traceId: request.traceId,
          requestId: request.requestId,
        });
        return {
          flowRunId,
          success: false,
          stepResults,
          output: "",
          duration: Math.max(0, Date.now() - startedAt.getTime()),
          startedAt,
          completedAt: new Date(),
        };
      }
      return await this.completion.handleExecutionError(flow, request, flowRunId, stepResults, startedAt, error);
    } finally {
      if (snapshotTraceId) await this.options.bindingService?.releaseRun(snapshotTraceId);
    }
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
    repeat?: Opt<{ iteration: number; feedback?: string }, Reason.OptionalContext>,
  ): Promise<IStepResult> {
    const step = flow.steps.find((s) => s.id === stepId)!;
    const startedAt = new Date();
    const stepCtx: IStepContext = {
      flowRunId,
      step,
      flow,
      request,
      stepResults,
      startedAt,
      loopIteration: repeat?.iteration,
      gateFeedback: repeat?.feedback,
    };

    const branchSkip = branchSkipReason(step, stepResults, this.controlStateStore.get(stepResults).state);
    if (branchSkip) {
      await this.eventLogger.log(FLOW_EVENT_STEP_SKIPPED, {
        flowRunId,
        stepId,
        reason: branchSkip,
        skipCode: FlowStepSkipCode.BRANCH_NOT_TAKEN,
        traceId: request.traceId,
        requestId: request.requestId,
      });
      await this.emitMilestone(
        MILESTONE_FLOW_STEP_SKIPPED,
        request.traceId,
        `Step ${step.name} skipped: ${branchSkip}`,
      );
      return {
        stepId,
        success: true,
        skipped: true,
        skipCode: FlowStepSkipCode.BRANCH_NOT_TAKEN,
        skipReason: branchSkip,
        duration: Math.max(0, Date.now() - startedAt.getTime()),
        startedAt,
        completedAt: new Date(),
      };
    }

    // Evaluate step condition if present
    const conditionResult = await this.stepGates.evaluateStepCondition(
      flowRunId,
      step,
      flow,
      stepResults,
      request,
      startedAt,
    );
    if (conditionResult) {
      return conditionResult;
    }

    // Log step queued (ready for execution)
    await this.eventLogger.log(DomainEventType.FlowStepQueued, {
      flowRunId,
      stepId,
      agentRole: step.agent_role,
      dependencies: step.dependsOn,
      inputSource: step.input.source,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    // Log step start
    await this.eventLogger.log(DomainEventType.FlowStepStarted, {
      flowRunId,
      stepId,
      agentRole: step.agent_role,
      strategy: step.strategy,
      traceId: request.traceId,
      requestId: request.requestId,
    });

    await this.emitMilestone(MILESTONE_FLOW_STEP_STARTED, request.traceId, `Step ${step.name || step.id} started`, {
      currentStepLabel: step.name || step.id,
    });

    try {
      const attemptOutcome = await this.runStepAttempt(
        stepCtx,
        repeat ? StepAttemptClass.RETRY : StepAttemptClass.INITIAL,
      );
      return this.stepIo.formatStepSuccess(
        stepCtx,
        attemptOutcome.result,
        undefined,
        attemptOutcome.namespaceWrites,
      );
    } catch (error) {
      if (repeat) return this.stepIo.formatStepFailure(flowRunId, step, request, error, startedAt);
      return await this.stepRecovery.handleStepFailureRecovery(
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
    const stepRequest = await this.stepIo.prepareStepRequest(flowRunId, step, flow, request, stepResults);
    if (ctx.loopIteration !== undefined) stepRequest.context.loopIteration = ctx.loopIteration;
    if (ctx.gateFeedback !== undefined) {
      stepRequest.context.gateFeedback = ctx.gateFeedback;
      stepRequest.userPrompt += `\n\nGate feedback:\n${ctx.gateFeedback}`;
    }
    const inputHash = await this.stepContentHasher.computeStepInputHash(stepRequest);
    const stepId = step.id;
    const traceId = request.traceId ?? flowRunId;

    const toolPolicyHash = await this.stepContentHasher.computeStringHash(JSON.stringify(step.permitted_tools ?? []));
    const portalScopeHash = await this.stepContentHasher.computeStringHash(JSON.stringify([]));

    const priorRecord = await this.stepDurabilityStore.findReplayCandidate({
      traceId,
      flowId: flow.id,
      stepId,
      inputHash,
      attemptClass,
      toolPolicyHash,
      portalScopeHash,
    });

    if (
      ctx.loopIteration === undefined && priorRecord && step.type !== FlowStepType.GATE &&
      step.type !== FlowStepType.BRANCH
    ) {
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

    record.sideEffectClass = this.stepContentHasher.computeSideEffectClass(step);

    await this.stepDurabilityStore.save(record);

    try {
      const result = await this.stepGates.executeStepLogic(ctx, stepRequest);
      record.completedAt = new Date().toISOString();
      record.durationMs = Math.max(0, Date.now() - startedAt.getTime());
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
}
