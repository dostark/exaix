/**
 * @module RequestProcessor
 * @path packages/request/src/processor.ts
 * @description Validates incoming request files, determines routing strategies (Agent vs Flow),
 * and generates execution plans. Acts as the primary entry point for the "Request Processing" phase.
 * @architectural-layer Services
 * @related-files ["packages/request/src/router.ts", "packages/execution/src/agent_runner.ts"]
 * @architectural-link [ARCHITECTURE.md#request-processing-flow]
 */

import { basename, dirname, join } from "@std/path";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { DatabaseService } from "@exaix/storage-sqlite";
import type { Config } from "@exaix/schemas/config.ts";
import {
  AgentRunner,
  type IAgentExecutionResult,
  type IBlueprint,
  type IParsedRequest,
  type IRequestContextContext,
} from "@exaix/execution";
import { applyAnalysisToRequest, buildParsedRequest } from "./common.ts";
import { IBlueprintLoader, type ILoadedBlueprint } from "@exaix/core/blueprint";
import { type IRequestMetadata, PlanWriter } from "@exaix/core/planning";
import { PlanValidationError } from "@exaix/core/planning";
import { RequestStatus } from "@exaix/core/status";
import { PlanStatus } from "@exaix/core/status";
import {
  COMPLEXITY_BODY_LENGTH_LOW,
  COMPLEXITY_BULLET_THRESHOLD_HIGH,
  COMPLEXITY_FILE_REF_PATTERN,
  COMPLEXITY_FILE_REF_THRESHOLD_HIGH,
  DEFAULT_ANALYZER_MODE,
  DEFAULT_IDENTITIES_PATH,
  MEMORY_CONTEXT_KEY,
  PORTAL_CONTEXT_KEY,
  PORTAL_KNOWLEDGE_KEY,
  PORTAL_KNOWLEDGE_PROMPT_MAX_LINES,
} from "@exaix/core";
import { DEFAULT_AI_TIMEOUT_MS } from "@exaix/ai/constants.ts";
import type {
  IApplicationContext,
  IPortalKnowledgeService,
  IRequestAnalyzerConfig,
  IRequestAnalyzerService,
  IRequestQualityGateService,
} from "@exaix/core/types";
import type { IFlow } from "@exaix/schemas/flow.ts";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import { buildPortalContextBlock } from "@exaix/core/func";
import type { IEventLogger } from "@exaix/core/logger";
import type { IFlowRunner } from "@exaix/flow";
import { DomainEventType } from "@exaix/core/events";
import type { IFlowValidatorService } from "@exaix/core/types";
import { ProviderFactory, ProviderRegistry } from "@exaix/ai";
import { ProviderSelector } from "@exaix/ai/provider_selector.ts";
import { CostTracker } from "@exaix/core/cost";
import { CircuitBreaker, CircuitBreakerProvider } from "@exaix/ai/circuit_breaker.ts";
import { RequestParser } from "./processing/parser.ts";
import { StatusManager } from "./processing/status.ts";
import type { IRequestFrontmatter, IParsedRequestFile } from "@exaix/core/request";
import { OutputValidator } from "@exaix/tool-runtime";
import type { LogMetadata } from "@exaix/core/types";
import { MiddlewarePipeline } from "@exaix/core/func";
import type { IServiceContext } from "@exaix/core/types";
import { RequestAnalyzer, saveAnalysis } from "./analysis/mod.ts";
import { type IRequestAnalysis, RequestAnalysisComplexity } from "@exaix/schemas/request_analysis.ts";
import { ProviderType, RequestKind, TaskComplexity } from "@exaix/core";
import type { ILogEvent } from "@exaix/core";
import {
  CompositeMilestoneEmitter,
  EventBusService,
  FileAppendMilestoneEmitter,
  MilestoneEventBusEmitter,
} from "@exaix/core/observability";
import type { IMilestoneEmitter } from "@exaix/core/observability";

import type { AnalysisMode } from "@exaix/core/types";
import { buildQualityGateConfig, loadClarification, RequestQualityGate, saveClarification } from "@exaix/quality-gate";
import { RequestQualityRecommendation } from "@exaix/schemas/request_quality_assessment.ts";
import { ClarificationSessionStatus } from "@exaix/schemas/clarification_session.ts";
import type { IRequestSpecification } from "@exaix/schemas/request_specification.ts";
import type { EnhancedRequest, SessionMemoryService } from "@exaix/memory";
import type { Opt, Reason } from "@exaix/core/types";

export interface IRequestProcessingContext extends IServiceContext {
  filePath: string;
  parsed: IParsedRequestFile;
  frontmatter: IRequestFrontmatter;
  body: string;
  traceLogger: IEventLogger;
  requestId: string;
  requestKind: RequestKind;
  analysis?: IRequestAnalysis;
  portalKnowledge?: IPortalKnowledge;
  memoryContext?: EnhancedRequest;
}

export interface IRequestProcessorConfig {
  workspacePath: string;
  requestsDir: string;
  blueprintsPath: string;
  includeReasoning: boolean;
  context?: IApplicationContext;

  // Optional overrides (primarily for testing)
  testProvider?: IModelProvider;
  costTracker?: CostTracker;
  testAnalyzer?: IRequestAnalyzerService;
  portalKnowledgeService?: IPortalKnowledgeService;
  testQualityGate?: IRequestQualityGateService;
  sessionMemory?: SessionMemoryService;
  testPipelineFactory?: () => MiddlewarePipeline<IRequestProcessingContext>;
  healthChecker?: { checkProvider(name: string): Promise<boolean> };
  providerBootstrap?: () => void;
  logger?: IEventLogger;
  // When no logger is provided, the constructor falls back to ctx.display,
  // and as a last resort creates an EventLogger internally.

  /** Optional callback invoked when a clarification wait state should be created. */
  onClarificationCreated?: (traceId: string, requestId: string) => Promise<void>;
  /** Optional callback invoked when a clarification wait state should be resolved. */
  onClarificationResolved?: (traceId: string) => Promise<void>;
  /**
   * Optional callback invoked when the refinement gate delegates to a session
   * tool. Fires after config-check: session_delegate.enabled && "refinement" in gates.
   * The daemon wires this to prepareBrief + park + launch.
   */
  onDelegateRefinement?: (traceId: string, requestId: string, body: string) => Promise<void>;
  /**
   * Optional FlowRunner for executing flow requests.
   * When set, processFlowRequest delegates to flowRunner.execute()
   * instead of generating a stub plan.
   */
  flowRunner?: IFlowRunner;
}

// ============================================================================
// RequestProcessor Implementation
// ============================================================================

export class RequestProcessor {
  private readonly planWriter: PlanWriter;
  private readonly plansDir: string;
  private readonly logger: IEventLogger;
  private readonly flowValidator: IFlowValidatorService | null;
  private readonly providerSelector: ProviderSelector;
  private readonly costTracker: CostTracker;
  private readonly ioBreaker: CircuitBreaker;
  private readonly requestParser: RequestParser;
  private readonly statusManager: StatusManager;
  private readonly analyzer: IRequestAnalyzerService;
  private readonly qualityGate?: IRequestQualityGateService;
  private readonly config: Config;
  private readonly db: DatabaseService;
  private readonly portalKnowledgeService?: IPortalKnowledgeService;
  private readonly sessionMemory?: SessionMemoryService;
  private readonly testProvider?: IModelProvider;
  private readonly flowRunner?: IFlowRunner;
  private readonly milestoneEmitter?: IMilestoneEmitter;

  constructor(private readonly processorConfig: IRequestProcessorConfig) {
    const ctx = processorConfig.context;
    if (!ctx) {
      throw new Error("RequestProcessor requires IApplicationContext.");
    }
    this.config = ctx.config.get();

    if (ctx.db instanceof DatabaseService) {
      this.db = ctx.db;
    } else {
      throw new Error("Application context database is not a DatabaseService");
    }

    // Initialize milestone emitter(s): bus streaming + optional journal file (Phase 92)
    const emitters: IMilestoneEmitter[] = [];
    if (this.config.execution?.milestone_streaming_enabled) {
      emitters.push(new MilestoneEventBusEmitter(EventBusService.getInstance()));
    }
    if (this.config.execution?.milestone_journal_path) {
      emitters.push(
        new FileAppendMilestoneEmitter(
          join(this.config.system.root, this.config.execution.milestone_journal_path),
        ),
      );
    }
    this.milestoneEmitter = emitters.length > 0 ? new CompositeMilestoneEmitter(emitters) : undefined;

    // Initialize services
    this.costTracker = processorConfig.costTracker ?? new CostTracker(this.db, this.config);
    const healthChecker = processorConfig.healthChecker ?? { checkProvider: () => Promise.resolve(true) };
    this.providerSelector = new ProviderSelector(
      ProviderRegistry,
      this.costTracker,
      healthChecker,
    );

    this.logger = processorConfig.logger ?? wrapLogger(ctx?.display as IEventLogger | undefined) ?? createNoopLogger();

    this.plansDir = join(processorConfig.workspacePath, "Plans");
    this.planWriter = new PlanWriter({
      plansDirectory: this.plansDir,
      db: this.db,
      includeReasoning: processorConfig.includeReasoning,
      generateWikiLinks: true,
      runtimeRoot: join(this.config.system.root, this.config.paths.runtime),
    });

    const _flowsDir = join(this.config.system.root, this.config.paths.flows);
    this.flowValidator = ctx.flowValidator ?? null;
    this.flowRunner = processorConfig.flowRunner;

    this.requestParser = new RequestParser(this.logger);
    this.statusManager = new StatusManager(this.logger);

    const analyzerConfig: IRequestAnalyzerConfig = {
      mode: (this.config.request_analysis?.mode ?? DEFAULT_ANALYZER_MODE) as AnalysisMode,
      actionabilityThreshold: this.config.request_analysis?.actionability_threshold,
      inferAcceptanceCriteria: this.config.request_analysis?.infer_acceptance_criteria,
    };
    this.analyzer = processorConfig.testAnalyzer ?? new RequestAnalyzer(
      analyzerConfig,
      this.testProvider,
      new OutputValidator(),
      this.db,
    );

    this.portalKnowledgeService = processorConfig.portalKnowledgeService ?? ctx?.portalKnowledge;
    this.sessionMemory = processorConfig.sessionMemory;
    this.testProvider = processorConfig.testProvider;

    this.qualityGate = processorConfig.testQualityGate;
    if (!this.qualityGate) {
      const qgConfig = buildQualityGateConfig(this.config.quality_gate ?? {});
      this.qualityGate = new RequestQualityGate(
        qgConfig,
        this.testProvider,
        new OutputValidator(),
        this.logger,
      );
    }

    this.ioBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: DEFAULT_AI_TIMEOUT_MS,
      halfOpenSuccessThreshold: 2,
      // The I/O breaker guards plan-writing against genuine filesystem/I/O faults.
      // A PlanValidationError means the LLM produced bad content for THIS request —
      // it is per-request, retried locally, and must never count toward opening a
      // cross-request breaker (which would starve every following identity). Only
      // infrastructure failures should trip it.
      isCountableFailure: (error: Error) => !(error instanceof PlanValidationError),
    });
  }

  async process(filePath: string): Promise<string | null> {
    this.logger.info(DomainEventType.RequestProcessStarted, filePath, {});
    const parsed = await this.requestParser.parse(filePath);
    if (!parsed) {
      return null;
    }

    const { frontmatter, body } = parsed;
    const traceId = frontmatter.trace_id;
    const requestId = basename(filePath, ".md");
    const traceLogger = this.logger.child({ traceId });

    traceLogger.info(DomainEventType.RequestProcessing, filePath, {
      flow: frontmatter.flow ?? null,
      agent: frontmatter.identity ?? null,
      priority: frontmatter.priority ?? null,
    });

    if (this.shouldSkipRequest(frontmatter, traceLogger, filePath)) {
      traceLogger.info(DomainEventType.RequestSkipped, filePath, {
        reason: `Request already has status '${frontmatter.status}'`,
      });
      return null;
    }

    const requestKind = await this.getRequestKindOrFail({
      frontmatter,
      filePath,
      traceLogger,
    });
    if (!requestKind) {
      return null;
    }

    // Quality gate assessment (Phase 47) — runs before analysis and agent execution
    // Gap §13: bypass re-assessment when assessed_at is already set (request already passed the gate)
    const alreadyAssessed = !!frontmatter.assessed_at;
    const qgOutcome: { earlyReturn: true } | {
      earlyReturn: false;
      enrichedBody?: string;
      specification?: IRequestSpecification;
    } = alreadyAssessed
      ? await this._loadSpecFromClarification(filePath)
      : await this._runQualityGate(body, filePath, requestId, traceLogger, traceId);
    if (qgOutcome.earlyReturn) {
      return null;
    }
    const assessedBody = qgOutcome.enrichedBody ?? body;
    const clarificationSpec = qgOutcome.specification;

    const pipeline = this.processorConfig.testPipelineFactory?.() ?? this.createRequestProcessingPipeline();

    // Enhance request with session memory context before analysis
    const memoryContext = this.sessionMemory
      ? await this.sessionMemory.enhanceRequest(assessedBody).catch((err) => {
        this.logger.warn(DomainEventType.RequestMemoryEnhanceFailed, "Session memory enhancement failed", {
          error: String(err),
        });
        return undefined;
      })
      : undefined;

    // Run analysis before pipeline so both agent and flow paths benefit
    // Skip if analysis is disabled in config
    const analysisEnabled = this.config.request_analysis?.enabled !== false;
    const persistAnalysis = this.config.request_analysis?.persist_analysis !== false;
    const analysisMode = (this.config.request_analysis?.mode ?? DEFAULT_ANALYZER_MODE) as AnalysisMode;
    const analysis = analysisEnabled
      ? await this.analyzer.analyze(assessedBody, {
        identityId: frontmatter.identity ?? frontmatter.identity ?? frontmatter.flow,
        priority: frontmatter.priority,
        mode: analysisMode,
        memories: memoryContext,
      }).catch(() => undefined)
      : undefined;

    if (analysis && persistAnalysis) {
      await saveAnalysis(filePath, analysis).catch(() => {});
    }

    // Resolve portal knowledge for portal-bound requests
    const portal = frontmatter.portal;
    let portalKnowledge: IPortalKnowledge | undefined;
    if (this.portalKnowledgeService && portal) {
      const portalPath = (this.config.portals ?? []).find((p) => p.alias === portal)?.target_path;
      if (portalPath) {
        portalKnowledge = await this.portalKnowledgeService
          .getOrAnalyze(portal, portalPath)
          .catch(() => undefined);
      }
    }

    const context: IRequestProcessingContext = {
      filePath,
      parsed,
      frontmatter,
      body: assessedBody,
      traceLogger,
      requestId,
      requestKind,
      analysis,
      portalKnowledge,
      memoryContext,
    };

    try {
      const planPath = await pipeline.execute<string | null>(context, () => {
        return this.processRequestByKind(
          requestKind,
          frontmatter,
          assessedBody,
          filePath,
          requestId,
          traceId,
          traceLogger,
          context.analysis,
          context.portalKnowledge,
          clarificationSpec,
          context.memoryContext,
        );
      });

      return planPath;
    } catch (error: Error | unknown) {
      // Read the current content of the file before handling the error

      await this.handleError(error, filePath, requestId, traceLogger, frontmatter);
      return null;
    } finally {
      try {
        await this.costTracker.flush();
      } catch {
        // Ignore flush errors during processing
      }
    }
  }

  /**
   * Loads IRequestSpecification from a completed clarification session, bypassing
   * the quality gate assessment. Used when `assessed_at` is present in frontmatter
   * (Gap §13: re-assessment bypass for already-assessed requests).
   */
  private async _loadSpecFromClarification(
    filePath: string,
  ): Promise<{ earlyReturn: false; specification?: IRequestSpecification }> {
    const completedSession = await loadClarification(filePath).catch(() => null);
    const specification = completedSession?.refinedBody &&
        (completedSession.status === ClarificationSessionStatus.AGENT_SATISFIED ||
          completedSession.status === ClarificationSessionStatus.USER_CONFIRMED)
      ? completedSession.refinedBody
      : undefined;
    return { earlyReturn: false, specification };
  }

  /** Evaluates quality gate and returns early-return signal or enriched body. */
  private async _runQualityGate(
    body: string,
    filePath: string,
    requestId: string,
    traceLogger: IEventLogger,
    traceId: Opt<string, Reason.TraceAbsent>,
  ): Promise<
    { earlyReturn: true } | { earlyReturn: false; enrichedBody?: string; specification?: IRequestSpecification }
  > {
    if (!this.qualityGate) {
      // Load any completed clarification session even without an active gate
      const completedSession = await loadClarification(filePath).catch(() => null);
      const specification = completedSession?.refinedBody &&
          (completedSession.status === ClarificationSessionStatus.AGENT_SATISFIED ||
            completedSession.status === ClarificationSessionStatus.USER_CONFIRMED)
        ? completedSession.refinedBody
        : undefined;
      return { earlyReturn: false, specification };
    }
    try {
      const qgResult = await this.qualityGate.assess(body, { requestId });
      if (qgResult.recommendation === RequestQualityRecommendation.REJECT) {
        await this.statusManager.updateStatus(filePath, RequestStatus.FAILED, "Request rejected by quality gate");
        return { earlyReturn: true };
      }
      if (qgResult.recommendation === RequestQualityRecommendation.NEEDS_CLARIFICATION) {
        if (await this._tryDelegateRefinement(filePath, requestId, body, traceId)) {
          return { earlyReturn: true };
        }
        await this._startClarificationSession(filePath, requestId, body, traceId);
        return { earlyReturn: true };
      }
      if (qgResult.recommendation === RequestQualityRecommendation.AUTO_ENRICH && qgResult.enrichedBody) {
        return { earlyReturn: false, enrichedBody: qgResult.enrichedBody };
      }
      // Load IRequestSpecification from any completed clarification session
      const completedSession = await loadClarification(filePath).catch(() => null);
      const specification = completedSession?.refinedBody &&
          (completedSession.status === ClarificationSessionStatus.AGENT_SATISFIED ||
            completedSession.status === ClarificationSessionStatus.USER_CONFIRMED)
        ? completedSession.refinedBody
        : undefined;
      return { earlyReturn: false, specification };
    } catch {
      traceLogger.warn(DomainEventType.RequestQualityGateFailed, filePath, { requestId });
    }
    return { earlyReturn: false };
  }

  /**
   * Phase 111 Step 5: config-gated refinement delegation branch.
   * Returns true when delegation was initiated (brief prepared, wait parked, launch triggered).
   */
  private async _tryDelegateRefinement(
    filePath: string,
    requestId: string,
    body: string,
    traceId?: Opt<string, Reason.TraceAbsent>,
  ): Promise<boolean> {
    const sd = this.config.session_delegate;
    if (!sd?.enabled || !sd.gates?.includes("refinement") || !this.processorConfig.onDelegateRefinement) {
      return false;
    }
    await this.statusManager.updateStatus(filePath, RequestStatus.REFINING);
    if (traceId) {
      await this.processorConfig.onDelegateRefinement(traceId, requestId, body);
    }
    return true;
  }

  private async _startClarificationSession(
    filePath: string,
    requestId: string,
    body: string,
    traceId?: Opt<string, Reason.TraceAbsent>,
  ): Promise<void> {
    await this.statusManager.updateStatus(filePath, RequestStatus.REFINING);
    try {
      const session = await this.qualityGate!.startClarification(requestId, body);
      await saveClarification(filePath, session);
      if (traceId && this.processorConfig.onClarificationCreated) {
        await this.processorConfig.onClarificationCreated(traceId, requestId);
      }
    } catch {
      // Session start failed; REFINING status is preserved
    }
  }

  private shouldSkipRequest(frontmatter: IRequestFrontmatter, _traceLogger: IEventLogger, _filePath: string): boolean {
    switch (frontmatter.status) {
      case RequestStatus.PLANNED:
      case RequestStatus.COMPLETED:
      case RequestStatus.FAILED:
      case RequestStatus.CANCELLED:
      // Gap §1: NEEDS_CLARIFICATION → skip (awaiting user response; re-entry via finalizeAndWritePending)
      case RequestStatus.NEEDS_CLARIFICATION:
      // Gap §1: REFINING → skip (active Q&A session; FileWatcher must not interrupt)
      case RequestStatus.REFINING:
      case RequestStatus.ANALYZING:
        return true;
      default:
        return false;
    }
  }

  private async getRequestKindOrFail(args: {
    frontmatter: IRequestFrontmatter;
    filePath: string;
    traceLogger: IEventLogger;
  }): Promise<RequestKind | null> {
    const { frontmatter, filePath, traceLogger } = args;

    const hasFlow = !!frontmatter.flow;
    const hasAgent = !!frontmatter.identity || !!frontmatter.identity;

    if (hasFlow && hasAgent) {
      traceLogger.error(DomainEventType.RequestInvalid, filePath, {
        error: "Request cannot specify both 'flow' and 'agent' fields",
      });
      await this.statusManager.updateStatus(
        filePath,
        RequestStatus.FAILED,
        "Request cannot specify both 'flow' and 'agent' fields",
      );
      return null;
    }

    if (!hasAgent && !hasFlow) {
      traceLogger.error(DomainEventType.RequestInvalid, filePath, {
        error: "Request must specify either 'flow' or 'agent' field",
      });
      await this.statusManager.updateStatus(
        filePath,
        RequestStatus.FAILED,
        "Request must specify either 'flow' or 'agent' field",
      );
      return null;
    }

    return hasFlow ? RequestKind.FLOW : RequestKind.IDENTITY;
  }

  private createRequestProcessingPipeline(): MiddlewarePipeline<IRequestProcessingContext> {
    const pipeline = new MiddlewarePipeline<IRequestProcessingContext>();

    pipeline.use(async (ctx, next) => {
      try {
        await next();
      } catch (err) {
        try {
          ctx.traceLogger?.error(DomainEventType.RequestProcessingError, ctx.filePath, {
            error: err instanceof Error ? err.message : String(err),
          });
        } catch {
          // Ignore logging errors
        }
        throw err;
      }
    });

    pipeline.use(async (ctx, next) => {
      const start = (typeof performance !== "undefined") ? performance.now() : Date.now();
      await next();
      const duration = Math.round(((typeof performance !== "undefined") ? performance.now() : Date.now()) - start);
      try {
        ctx.traceLogger?.info(DomainEventType.RequestProcessingDuration, ctx.filePath, { duration_ms: duration });
      } catch {
        // Ignore logging errors
      }
    });

    return pipeline;
  }

  private processRequestByKind(
    kind: RequestKind,
    frontmatter: IRequestFrontmatter,
    body: string,
    filePath: string,
    requestId: string,
    traceId: string,
    traceLogger: IEventLogger,
    analysis?: Opt<IRequestAnalysis, Reason.OptionalInput>,
    portalKnowledge?: Opt<IPortalKnowledge, Reason.OptionalInput>,
    specification?: Opt<IRequestSpecification, Reason.OptionalInput>,
    memoryContext?: Opt<EnhancedRequest, Reason.OptionalInput>,
  ): Promise<string | null> {
    if (kind === RequestKind.FLOW) {
      return this.processFlowRequest(frontmatter, filePath, requestId, traceId, traceLogger, analysis, portalKnowledge);
    }

    return this.processAgentRequest(
      frontmatter,
      body,
      filePath,
      requestId,
      traceId,
      traceLogger,
      analysis,
      portalKnowledge,
      specification,
      memoryContext,
    );
  }

  private async processFlowRequest(
    frontmatter: IRequestFrontmatter,
    filePath: string,
    requestId: string,
    traceId: string,
    traceLogger: IEventLogger,
    analysis?: Opt<IRequestAnalysis, Reason.OptionalInput>,
    _portalKnowledge?: Opt<IPortalKnowledge, Reason.OptionalInput>,
  ): Promise<string | null> {
    if (this.flowValidator) {
      const validation = await this.flowValidator.validateFlow(frontmatter.flow!);
      if (!validation.valid) {
        traceLogger.error(DomainEventType.RequestFlowValidationFailed, frontmatter.flow!, {
          error: validation.error ?? null,
        });
        await this.statusManager.updateStatus(
          filePath,
          RequestStatus.FAILED,
          `Flow validation failed: ${validation.error}`,
        );
        return null;
      }
    }

    // If a FlowRunner is configured, delegate to real multi-agent execution
    if (this.flowRunner) {
      const flow = { id: frontmatter.flow } as IFlow;
      const body = await Deno.readTextFile(filePath);
      const flowResult = await this.flowRunner.execute(flow, {
        userPrompt: body,
        traceId,
        requestId,
        portal: frontmatter.portal,
      });

      const result = {
        thought: `Flow ${frontmatter.flow} executed (${flowResult.duration}ms)`,
        content: flowResult.output,
        raw: flowResult.output,
      };

      const metadata: IRequestMetadata = {
        requestId,
        traceId,
        createdAt: new Date(frontmatter.created),
        contextFiles: [],
        contextWarnings: [],
        model: frontmatter.model,
        portal: frontmatter.portal,
        targetBranch: frontmatter.target_branch,
        requestAnalysis: analysis,
      };

      return await this.writePlanAndReturnPath(result, metadata, filePath, traceLogger, {
        flow: frontmatter.flow ?? null,
      });
    }

    // Fallback: generate a stub plan (legacy path, used when no FlowRunner is configured)
    const planContent = JSON.stringify({
      subject: `Flow Execution: ${frontmatter.flow}`,
      description: `Execute the ${frontmatter.flow} flow`,
      steps: [{
        step: 1,
        title: "Execute Flow",
        description: `Execute the ${frontmatter.flow} flow with the provided request`,
        flow: frontmatter.flow,
      }],
    });

    const result = {
      thought: `Prepared flow ${frontmatter.flow} for execution`,
      content: planContent,
      raw: planContent,
    };

    const metadata: IRequestMetadata = {
      requestId,
      traceId,
      createdAt: new Date(frontmatter.created),
      contextFiles: [],
      contextWarnings: [],
      model: frontmatter.model,
      portal: frontmatter.portal,
      targetBranch: frontmatter.target_branch,
      requestAnalysis: analysis,
    };

    return await this.writePlanAndReturnPath(result, metadata, filePath, traceLogger, {
      flow: frontmatter.flow ?? null,
    });
  }

  private getProviderSelectionConfig(): Config {
    return this.config;
  }

  private async processAgentRequest(
    frontmatter: IRequestFrontmatter,
    body: string,
    filePath: string,
    requestId: string,
    traceId: string,
    traceLogger: IEventLogger,
    analysis?: Opt<IRequestAnalysis, Reason.OptionalInput>,
    portalKnowledge?: Opt<IPortalKnowledge, Reason.OptionalInput>,
    specification?: Opt<IRequestSpecification, Reason.OptionalInput>,
    memoryContext?: Opt<EnhancedRequest, Reason.OptionalInput>,
  ): Promise<string | null> {
    const identityId = frontmatter.identity || frontmatter.identity;
    const loadedBlueprint = await this.loadBlueprintWithFallback(identityId!, traceLogger);

    if (!loadedBlueprint) {
      return this.handleBlueprintNotFound(filePath, identityId!, traceLogger);
    }

    const blueprintLoader = new IBlueprintLoader({ blueprintsPath: this.processorConfig.blueprintsPath });
    const blueprint = blueprintLoader.toLegacyBlueprint(loadedBlueprint);

    const request: IParsedRequest = buildParsedRequest(body, frontmatter, requestId, traceId) as IParsedRequest;
    if (analysis) {
      applyAnalysisToRequest(request, analysis);
    }
    if (specification) {
      // Serialize to a plain record — IRequestSpecification is structurally
      // compatible with IRequestContextContext (all fields are string/string[]).
      request.context["specification"] = JSON.parse(JSON.stringify(specification)) as IRequestContextContext;
    }
    const portalContext = await this.buildPortalContext(frontmatter.portal, traceLogger);
    if (portalContext) {
      request.context[PORTAL_CONTEXT_KEY] = portalContext;
    }
    if (portalKnowledge) {
      const summary = await this._resolveKnowledgeContext(body, frontmatter.portal, portalKnowledge);
      request.context[PORTAL_KNOWLEDGE_KEY] = summary;
    }
    if (memoryContext?.memoryContext) {
      request.context[MEMORY_CONTEXT_KEY] = memoryContext.memoryContext;
    }

    const taskComplexity = this.classifyTaskComplexity(blueprint, request, analysis);
    let selectedProvider: IModelProvider;

    if (this.testProvider) {
      selectedProvider = this.testProvider;
      traceLogger.info(DomainEventType.RequestProviderSelected, "test-provider", {
        taskComplexity,
        trace_id: traceId,
      });
    } else {
      let selectedProviderName: string;
      try {
        selectedProviderName = await this.providerSelector.selectProviderForTask(
          this.getProviderSelectionConfig(),
          taskComplexity,
        );
      } catch (selErr) {
        traceLogger.warn(DomainEventType.RequestProviderSelectionFailed, String(selErr), {
          fallback: ProviderType.MOCK,
        });
        selectedProviderName = ProviderType.MOCK;
      }

      (this.processorConfig.providerBootstrap ?? (() => {}))();
      const rawProvider = await ProviderFactory.createByName(
        this.config,
        selectedProviderName,
        this.db,
        traceLogger,
        this.costTracker,
      );
      selectedProvider = new CircuitBreakerProvider(rawProvider, {
        failureThreshold: 5,
        resetTimeout: 60_000,
        halfOpenSuccessThreshold: 2,
      });

      traceLogger.info(DomainEventType.RequestProviderSelected, selectedProviderName, {
        taskComplexity,
        trace_id: traceId,
        provider_wrapped: selectedProvider.id,
      });
    }

    const agentRunner = new AgentRunner(
      selectedProvider,
      { milestoneEmitter: this.milestoneEmitter },
    );
    const metadata: IRequestMetadata = {
      requestId,
      traceId,
      createdAt: new Date(frontmatter.created),
      contextFiles: [],
      contextWarnings: [],
      identityId: frontmatter.identity || frontmatter.identity,
      model: frontmatter.model,
      portal: frontmatter.portal,
      targetBranch: frontmatter.target_branch,
      subject: frontmatter.subject,
      requestAnalysis: analysis,
    };

    let result = await agentRunner.run(blueprint, request);
    let attempts = 0;
    const maxRetries = 2;

    while (attempts <= maxRetries) {
      try {
        return await this.writePlanAndReturnPath(result, metadata, filePath, traceLogger);
      } catch (error) {
        if (error instanceof PlanValidationError && attempts < maxRetries) {
          attempts++;
          traceLogger.info(DomainEventType.RequestValidationRetry, requestId, {
            attempt: attempts,
            error: error.message,
          });

          // Create a feedback request for self-correction
          const feedbackRequest: IParsedRequest = {
            ...request,
            userPrompt: `Your previous output failed validation with the following error: "${error.message}".
Please fix the JSON in your <content> section and try again. Ensure it strictly follows the schema provided.

Problematic output for reference:
${result.content}`,
          };

          result = await agentRunner.run(blueprint, feedbackRequest);
          continue;
        }
        throw error;
      }
    }

    return null; // Should be unreachable
  }

  /**
   * Resolve portal knowledge context, trying relevance-based retrieval
   * and falling back to the full summary.
   */
  private async _resolveKnowledgeContext(
    body: string,
    portalAlias: string | undefined,
    portalKnowledge: IPortalKnowledge,
  ): Promise<string> {
    const fallback = buildPortalKnowledgeSummary(portalKnowledge);
    if (!this.portalKnowledgeService || !portalAlias) return fallback;

    const portalPath = (this.config.portals ?? []).find(
      (p) => p.alias === portalAlias,
    )?.target_path;
    if (!portalPath) return fallback;

    try {
      const relevant = await this.portalKnowledgeService.getRelevantContext(
        body,
        portalPath,
        PORTAL_KNOWLEDGE_PROMPT_MAX_LINES * 50,
      );
      return relevant ?? fallback;
    } catch {
      return fallback;
    }
  }

  private async handleBlueprintNotFound(
    filePath: string,
    identityId: string,
    traceLogger: IEventLogger,
  ): Promise<string | null> {
    traceLogger.error(DomainEventType.RequestBlueprintNotFound, identityId, { request: filePath });
    await this.statusManager.updateStatus(filePath, RequestStatus.FAILED, `Blueprint not found: ${identityId}`);
    traceLogger.error(DomainEventType.RequestFailed, filePath, { error: `Blueprint not found: ${identityId}` });
    return null;
  }

  private async loadBlueprintWithFallback(
    identityId: string,
    traceLogger: IEventLogger,
  ): Promise<ILoadedBlueprint | null> {
    const blueprintLoader = new IBlueprintLoader({ blueprintsPath: this.processorConfig.blueprintsPath });
    let loadedBlueprint = await blueprintLoader.load(identityId);

    if (!loadedBlueprint) {
      loadedBlueprint = await this.findBlueprintInWorktree(identityId, traceLogger);
    }
    if (!loadedBlueprint) {
      loadedBlueprint = await this.findBlueprintInRepoRoots(identityId, traceLogger);
    }
    return loadedBlueprint;
  }

  private async findBlueprintInWorktree(
    identityId: string,
    traceLogger: IEventLogger,
  ): Promise<ILoadedBlueprint | null> {
    let dir = Deno.cwd();
    while (true) {
      const candidatePath = join(dir, "Blueprints", DEFAULT_IDENTITIES_PATH);
      try {
        const candidateFile = join(candidatePath, `${identityId}.md`);
        try {
          const stat = await Deno.stat(candidateFile);
          if (stat && stat.isFile) {
            const fallbackLoader = new IBlueprintLoader({ blueprintsPath: candidatePath });
            const loadedBlueprint = await fallbackLoader.load(identityId);
            if (loadedBlueprint) {
              traceLogger.info(DomainEventType.RequestBlueprintLoadedFallback, identityId, { from: candidatePath });
              return loadedBlueprint;
            }
          }
        } catch {
          // File doesn't exist
        }
      } catch {
        // ignore
      }

      const parent = dir.replace(/\/[^\/]*$/, "");
      if (!parent || parent === dir) break;
      dir = parent;
    }
    return null;
  }

  private async findBlueprintInRepoRoots(
    identityId: string,
    traceLogger: IEventLogger,
  ): Promise<ILoadedBlueprint | null> {
    // Try the repository root (cwd) directly
    const repoIdentitiesPath = join(Deno.cwd(), "Blueprints", DEFAULT_IDENTITIES_PATH);
    const fallbackLoader = new IBlueprintLoader({ blueprintsPath: repoIdentitiesPath });
    const loadedBlueprint = await fallbackLoader.load(identityId);
    if (loadedBlueprint) {
      traceLogger.info(DomainEventType.RequestBlueprintLoadedFallback, identityId, { from: repoIdentitiesPath });
      return loadedBlueprint;
    }

    // Also try locating Blueprints relative to this module (repo root)
    try {
      const repoRoot = join(dirname(dirname(dirname(new URL(import.meta.url).pathname))));
      const repoModuleIdentities = join(repoRoot, "Blueprints", DEFAULT_IDENTITIES_PATH);
      const moduleLoader = new IBlueprintLoader({ blueprintsPath: repoModuleIdentities });
      const moduleLoaded = await moduleLoader.load(identityId);
      if (moduleLoaded) {
        traceLogger.info(DomainEventType.RequestBlueprintLoadedFallback, identityId, { from: repoModuleIdentities });
        return moduleLoaded;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async handleError(
    error: Error | string | unknown,
    filePath: string,
    requestId: string,
    traceLogger: IEventLogger,
    frontmatter?: Opt<IRequestFrontmatter, Reason.OptionalInput>,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    let persistedRejectedPath = false;
    if (error instanceof PlanValidationError) {
      const validationError = error;
      const rawDetails = validationError.details?.rawContent;
      const fullRawResponse = validationError.details?.fullRawResponse;

      traceLogger.info(DomainEventType.RequestValidationErrorDetected, requestId, {
        error_message: errorMessage,
        hasDetails: !!validationError.details,
        detailsKeys: validationError.details ? Object.keys(validationError.details) : [],
        hasRawDetails: typeof rawDetails === "string" && rawDetails.length > 0,
        rawDetailsLength: typeof rawDetails === "string" ? rawDetails.length : "not-string",
        hasFullRawResponse: typeof fullRawResponse === "string" && fullRawResponse.length > 0,
        fullRawResponseLength: typeof fullRawResponse === "string" ? fullRawResponse.length : "not-string",
      });

      // Always attempt to save rejected plan for debugging, even if raw content is missing
      try {
        const rejectedDir = join(
          this.config.system.root,
          this.config.paths.workspace,
          this.config.paths.rejected,
        );
        await Deno.mkdir(rejectedDir, { recursive: true });

        const rejectedPath = join(rejectedDir, `${requestId}_rejected.md`);

        // Use fullRawResponse as fallback if rawDetails is empty or missing
        const rawToSave = (typeof rawDetails === "string" && rawDetails.trim())
          ? rawDetails
          : (typeof fullRawResponse === "string" && fullRawResponse.trim())
          ? fullRawResponse
          : "No raw content available";

        const rejectedContent = this.formatRejectedPlan({
          frontmatter,
          requestId,
          traceId: frontmatter?.trace_id,
          errorMessage,
          rawDetails: rawToSave,
          validationError,
        });
        await Deno.writeTextFile(rejectedPath, rejectedContent);

        // Log the saved path for debugging, but keep the original error message
        // unchanged for storage in the request frontmatter (tests expect the
        // raw error string without appended path info).
        traceLogger.info(DomainEventType.RequestSavedRejected, rejectedPath, { reason: "validation_failed" });

        // Persist rejected_path into the request frontmatter so CLI/TUI can
        // expose the location to users for manual review. Use workspace-relative
        // path (e.g. Workspace/Rejected/...) for portability.
        const rejectedRelative = join(
          this.config.paths.workspace,
          this.config.paths.rejected,
          `${requestId}_rejected.md`,
        );
        await this.statusManager.updateStatus(Deno.realPathSync(filePath), RequestStatus.FAILED, errorMessage, {
          rejected_path: rejectedRelative,
        });
        persistedRejectedPath = true;
      } catch (writeErr) {
        traceLogger.warn(DomainEventType.RequestPlanSaveRejectedFailed, filePath, { error: String(writeErr) });
      }
    }

    traceLogger.error(DomainEventType.RequestFailed, filePath, {
      error: errorMessage,
    });

    // If we didn't already persist rejected_path above (e.g. non-validation errors),
    // persist the original error message without path metadata.
    if (!persistedRejectedPath) {
      await this.statusManager.updateStatus(Deno.realPathSync(filePath), RequestStatus.FAILED, errorMessage);
    }
  }

  private formatRejectedPlan(args: {
    frontmatter?: IRequestFrontmatter;
    requestId: string;
    traceId?: string;
    errorMessage: string;
    rawDetails: string;
    validationError: PlanValidationError;
  }): string {
    // Record the identity that produced this rejected draft so it has the same
    // attribution an accepted plan carries (identity_id) — reviewers and the
    // identity e2e can trace the draft back to its persona.
    const identityLine = args.frontmatter?.identity ? `identity_id: ${args.frontmatter.identity}\n` : "";
    return `---
trace_id: "${args.traceId ?? "unknown"}"
request_id: "${args.requestId}"
${identityLine}status: ${PlanStatus.REJECTED}
error: "${args.errorMessage.replace(/"/g, '\\"')}"
---

Rejected Plan: ${args.errorMessage}
Raw Details: ${args.rawDetails}
`;
  }

  private async writePlanAndReturnPath(
    result: IAgentExecutionResult,
    metadata: IRequestMetadata,
    filePath: string,
    traceLogger: IEventLogger,
    extra?: LogMetadata,
  ): Promise<string> {
    const planResult = await this.ioBreaker.execute(() => this.planWriter.writePlan(result, metadata));

    // Rule 3: the request's subject is NEVER overwritten by the agent's plan title — the request
    // subject is authoritative and stable. The plan carries its own name in `title`; the request
    // keeps its own subject. (Previously a fallback subject was "upgraded" to the agent title here;
    // that cross-contamination is removed so subject and title stay distinct.)
    await this.statusManager.updateStatus(filePath, RequestStatus.PLANNED, undefined);

    const logObj: LogMetadata = { plan_path: planResult.planPath, ...(extra ?? {}) };
    traceLogger.info(DomainEventType.RequestPlanned, filePath, logObj);
    return planResult.planPath;
  }

  private classifyTaskComplexity(
    blueprint: IBlueprint,
    request: IParsedRequest,
    analysis?: Opt<IRequestAnalysis, Reason.OptionalInput>,
  ): TaskComplexity {
    if (analysis?.complexity) {
      return this.mapAnalysisComplexity(analysis.complexity);
    }

    const bodySignals = this.checkContentHeuristics(request.userPrompt);
    if (bodySignals) return bodySignals;

    return this.classifyByAgentId(blueprint.identityId);
  }

  private mapAnalysisComplexity(complexity: RequestAnalysisComplexity): TaskComplexity {
    switch (complexity) {
      case RequestAnalysisComplexity.SIMPLE:
        return TaskComplexity.SIMPLE;
      case RequestAnalysisComplexity.MEDIUM:
        return TaskComplexity.MEDIUM;
      case RequestAnalysisComplexity.COMPLEX:
      case RequestAnalysisComplexity.EPIC:
        return TaskComplexity.COMPLEX;
      default:
        return TaskComplexity.MEDIUM;
    }
  }

  private checkContentHeuristics(
    body?: Opt<string, Reason.OptionalInput>,
  ): TaskComplexity | null {
    if (!body) return null;
    const fileRefs = body.match(COMPLEXITY_FILE_REF_PATTERN);
    if (fileRefs && fileRefs.length >= COMPLEXITY_FILE_REF_THRESHOLD_HIGH) return TaskComplexity.COMPLEX;
    const bulletPoints = (body.match(/\n\s*[-*]\s+/g) || []).length;
    if (bulletPoints >= COMPLEXITY_BULLET_THRESHOLD_HIGH) return TaskComplexity.COMPLEX;
    if (body.length < COMPLEXITY_BODY_LENGTH_LOW && !body.includes("\n-")) return TaskComplexity.SIMPLE;
    return null;
  }

  private classifyByAgentId(
    identityId?: Opt<string, Reason.OptionalContext>,
  ): TaskComplexity {
    const id = identityId || "";
    if (id.includes("analyzer") || id.includes("summarizer")) return TaskComplexity.SIMPLE;
    if (id.includes("coder") || id.includes("planner") || id.includes("architect")) {
      return TaskComplexity.COMPLEX;
    }
    return TaskComplexity.MEDIUM;
  }

  private async buildPortalContext(
    portalAlias?: Opt<string, Reason.OptionalContext>,
    traceLogger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ): Promise<string | null> {
    if (!portalAlias) return null;

    const portal = this.config.portals.find((p) => p.alias === portalAlias);
    if (!portal) {
      traceLogger?.warn("portal.context.not_found", portalAlias, { portal: portalAlias });
      return null;
    }

    const fileSummary = await this.getPortalFileSummary(portal.target_path);

    return buildPortalContextBlock({
      portalAlias,
      portalRoot: portal.target_path,
      fileList: fileSummary,
    });
  }

  private async getPortalFileSummary(portalPath: string): Promise<string> {
    const files: string[] = [];
    const context = { files, MAX_FILES: 200, MAX_DEPTH: 3 };

    try {
      await this.scanPortalDirectory(portalPath, 0, context);
    } catch {
      return "Unable to list portal directory.";
    }

    if (files.length === 0) return "Portal directory is empty.";
    return files.join("\n");
  }

  private async scanPortalDirectory(
    dir: string,
    currentDepth: number,
    context: { files: string[]; MAX_FILES: number; MAX_DEPTH: number },
  ): Promise<void> {
    if (currentDepth > context.MAX_DEPTH || context.files.length >= context.MAX_FILES) return;

    try {
      const entries = [];
      for await (const entry of Deno.readDir(dir)) {
        entries.push(entry);
      }

      // Sort entries: directories first, then files alphabetically
      entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const entry of entries) {
        if (context.files.length >= context.MAX_FILES) break;
        if (entry.name.startsWith(".")) continue;

        const indent = "  ".repeat(currentDepth);
        context.files.push(`${indent}${entry.isDirectory ? "[DIR] " : "- "}${entry.name}`);

        if (entry.isDirectory) {
          await this.scanPortalDirectory(join(dir, entry.name), currentDepth + 1, context);
        }
      }
    } catch {
      // Ignore read errors for specific directories
    }
  }
}

// ============================================================================
// Exported helpers
// ============================================================================

/**
 * Build a capped Markdown summary of IPortalKnowledge for injection into agent prompts.
 * Includes: architecture overview (first 20 lines), top-5 key files, top-5 conventions
 * sorted by evidenceCount descending. Capped at maxLines lines.
 */
export function buildPortalKnowledgeSummary(
  knowledge: IPortalKnowledge,
  maxLines: Opt<number, Reason.SensibleDefault> = PORTAL_KNOWLEDGE_PROMPT_MAX_LINES,
): string {
  const lines: string[] = ["## Portal Knowledge Summary"];

  if (knowledge.architectureOverview) {
    lines.push("### Architecture");
    const overviewLines = knowledge.architectureOverview.split("\n").slice(0, 20);
    lines.push(...overviewLines);
  }

  if (knowledge.keyFiles.length > 0) {
    lines.push("### Key Files");
    for (const kf of knowledge.keyFiles.slice(0, 5)) {
      lines.push(`- \`${kf.path}\` (${kf.role}): ${kf.description}`);
    }
  }

  const topConventions = [...knowledge.conventions]
    .sort((a, b) => b.evidenceCount - a.evidenceCount)
    .slice(0, 5);
  if (topConventions.length > 0) {
    lines.push("### Conventions");
    for (const c of topConventions) {
      lines.push(`- ${c.name}: ${c.description}`);
    }
  }

  return lines.slice(0, maxLines).join("\n");
}

/** Wrap an IDisplayService as IEventLogger, adding .child() if missing. */
function wrapLogger(
  display?: Opt<IEventLogger, Reason.OptionalDependency>,
): IEventLogger | undefined {
  if (!display) return undefined;
  if (typeof (display as { child?: (...args: Array<never>) => void }).child === "function") return display;
  const makeChild = (overrides: Partial<ILogEvent>): IEventLogger => ({
    log: (_event: ILogEvent) => Promise.resolve(),
    info: (action, target, payload, traceId) => display.info(action, target, payload, traceId ?? overrides.traceId),
    warn: (action, target, payload, traceId) => display.warn(action, target, payload, traceId ?? overrides.traceId),
    error: (action, target, payload, traceId) => display.error(action, target, payload, traceId ?? overrides.traceId),
    fatal: (action, target, payload, traceId) => display.fatal(action, target, payload, traceId ?? overrides.traceId),
    debug: (action, target, payload, traceId) => display.debug(action, target, payload, traceId ?? overrides.traceId),
    child: (nested) => makeChild({ ...overrides, ...nested }),
  });
  return makeChild({});
}

/** No-op IEventLogger used as fallback when no logger is provided. */
function createNoopLogger(): IEventLogger {
  const noop = async () => {};
  const logger: IEventLogger = {
    log: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    debug: noop,
    child: () => logger,
  };
  return logger;
}
