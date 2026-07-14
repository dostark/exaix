/**
 * @module RequestProcessor
 * @path packages/request/src/processor.ts
 * @description Validates incoming request files, determines routing strategies (Agent vs Flow),
 * and generates execution plans. Acts as the primary entry point for the "Request Processing" phase.
 * @architectural-layer Services
 * @related-files ["packages/request/src/router.ts", "packages/execution/src/agent_runner.ts"]
 * @architectural-link [ARCHITECTURE.md#request-processing-flow]
 */

import { basename, join } from "@std/path";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { IAgentExecutionResult, IParsedRequest, IRequestContextContext } from "@exaix/execution";
import { applyAnalysisToRequest, buildParsedRequest } from "./common.ts";
import { IBlueprintLoader } from "@exaix/core/blueprint";
import { type IRequestMetadata, PlanWriter } from "@exaix/core/planning";
import { PlanValidationError } from "@exaix/core/planning";
import { RequestStatus } from "@exaix/core/status";
import {
  DEFAULT_ANALYZER_MODE,
  MEMORY_CONTEXT_KEY,
  PORTAL_CONTEXT_KEY,
  PORTAL_KNOWLEDGE_KEY,
  PORTAL_KNOWLEDGE_PROMPT_MAX_LINES,
} from "@exaix/core";
import { DEFAULT_AI_TIMEOUT_MS } from "@exaix/ai/constants.ts";
import type {
  IApplicationContext,
  IDatabaseService,
  IPortalKnowledgeService,
  IRequestAnalyzerConfig,
  IRequestAnalyzerService,
  IRequestQualityGateService,
} from "@exaix/core/types";
import type { IFlow } from "@exaix/schemas/flow.ts";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
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
import type { IParsedRequestFile, IRequestFrontmatter } from "@exaix/core/request";
import type { LogMetadata } from "@exaix/core/types";
import { createOutputValidator, type IOutputValidator } from "@exaix/tool-runtime";
import type { IAgentRunner } from "@exaix/execution";
import { buildRequestQualityGateFromConfig } from "@exaix/quality-gate";
import { MiddlewarePipeline } from "@exaix/core/func";
import type { IServiceContext } from "@exaix/core/types";
import { RequestAnalyzer, saveAnalysis } from "./analysis/mod.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import { ProviderType, RequestKind } from "@exaix/core";
import { type ITaskComplexityClassifier, TaskComplexityClassifier } from "./task_complexity_classifier.ts";
import { BlueprintResolver, type IBlueprintResolver } from "./blueprint_resolver.ts";
import { type IPortalContextBuilder, PortalContextBuilder } from "./portal_context_builder.ts";
import { ClarificationGateway, type IClarificationGateway } from "./clarification_gateway.ts";
import { type IRejectedPlanHandler, RejectedPlanHandler } from "./rejected_plan_handler.ts";
import type { ILogEvent } from "@exaix/core";
import { buildMilestoneEmitterFromConfig } from "@exaix/core/observability";
import type { IMilestoneEmitter } from "@exaix/core/observability";

import type { AnalysisMode } from "@exaix/core/types";

import type { IRequestSpecification } from "@exaix/schemas/request_specification.ts";
import type { EnhancedRequest, SessionMemoryService } from "@exaix/memory";
import type { Opt, Reason } from "@exaix/core/types";

/** Shared options for internal request-processing methods (reduces max-params). */
interface IProcessRequestOptions {
  frontmatter: IRequestFrontmatter;
  body: string;
  filePath: string;
  requestId: string;
  traceId: string;
  traceLogger: IEventLogger;
  analysis?: IRequestAnalysis;
  portalKnowledge?: IPortalKnowledge;
  specification?: IRequestSpecification;
  memoryContext?: EnhancedRequest;
}

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
  outputValidator?: IOutputValidator;
  agentRunner?: IAgentRunner;
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
  private readonly db: IDatabaseService;
  private readonly portalKnowledgeService?: IPortalKnowledgeService;
  private readonly sessionMemory?: SessionMemoryService;
  private readonly testProvider?: IModelProvider;
  private readonly flowRunner?: IFlowRunner;
  private readonly milestoneEmitter?: IMilestoneEmitter;
  private readonly taskComplexityClassifier: ITaskComplexityClassifier;
  private readonly blueprintResolver: IBlueprintResolver;
  private readonly portalContextBuilder: IPortalContextBuilder;
  private readonly clarificationGateway: IClarificationGateway;
  private readonly rejectedPlanHandler: IRejectedPlanHandler;

  constructor(private readonly processorConfig: IRequestProcessorConfig) {
    const ctx = processorConfig.context;
    if (!ctx) {
      throw new Error("RequestProcessor requires IApplicationContext.");
    }
    this.config = ctx.config.get();

    this.db = ctx.db;

    // Initialize milestone emitter(s): bus streaming + optional journal file (Phase 92)
    this.milestoneEmitter = buildMilestoneEmitterFromConfig(this.config);

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
    const outputValidator = processorConfig.outputValidator ?? createOutputValidator();
    this.analyzer = processorConfig.testAnalyzer ?? new RequestAnalyzer(
      analyzerConfig,
      this.testProvider,
      outputValidator,
      this.db,
    );

    this.portalKnowledgeService = processorConfig.portalKnowledgeService ?? ctx?.portalKnowledge;
    this.sessionMemory = processorConfig.sessionMemory;
    this.testProvider = processorConfig.testProvider;

    this.qualityGate = processorConfig.testQualityGate ??
      buildRequestQualityGateFromConfig(
        this.config.quality_gate ?? {},
        this.testProvider,
        outputValidator,
        this.logger,
      );

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

    this.taskComplexityClassifier = new TaskComplexityClassifier();
    this.blueprintResolver = new BlueprintResolver({ blueprintsPath: processorConfig.blueprintsPath });
    this.portalContextBuilder = new PortalContextBuilder({
      config: this.config,
      portalKnowledgeService: this.portalKnowledgeService,
    });
    this.clarificationGateway = new ClarificationGateway({
      statusManager: this.statusManager,
      qualityGate: this.qualityGate,
      sessionDelegateEnabled: this.config.session_delegate?.enabled,
      sessionDelegateRefinementGate: this.config.session_delegate?.gates?.includes("refinement"),
      onDelegateRefinement: processorConfig.onDelegateRefinement,
      onClarificationCreated: processorConfig.onClarificationCreated,
    });
    this.rejectedPlanHandler = new RejectedPlanHandler({ config: this.config, statusManager: this.statusManager });
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
      ? await this.clarificationGateway.loadSpecFromClarification(filePath)
      : await this.clarificationGateway.runQualityGate(body, filePath, requestId, traceLogger, traceId);
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
        const opts: IProcessRequestOptions = {
          frontmatter,
          body: assessedBody,
          filePath,
          requestId,
          traceId,
          traceLogger,
          analysis: context.analysis,
          portalKnowledge: context.portalKnowledge,
          specification: clarificationSpec,
          memoryContext: context.memoryContext,
        };
        return this.processRequestByKind(requestKind, opts);
      });

      return planPath;
    } catch (error: Error | unknown) {
      // Read the current content of the file before handling the error

      await this.rejectedPlanHandler.handleError(error, filePath, requestId, traceLogger, frontmatter);
      return null;
    } finally {
      try {
        await this.costTracker.flush();
      } catch {
        // Ignore flush errors during processing
      }
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
    opts: IProcessRequestOptions,
  ): Promise<string | null> {
    if (kind === RequestKind.FLOW) {
      return this.processFlowRequest(opts);
    }

    return this.processAgentRequest(opts);
  }

  private async processFlowRequest(
    opts: IProcessRequestOptions,
  ): Promise<string | null> {
    const { frontmatter, filePath, traceId, requestId, traceLogger, analysis } = opts;
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
    opts: IProcessRequestOptions,
  ): Promise<string | null> {
    const {
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
    } = opts;
    const identityId = frontmatter.identity || frontmatter.identity;
    const loadedBlueprint = await this.blueprintResolver.resolve(identityId!, traceLogger);

    if (!loadedBlueprint) {
      return this.handleBlueprintNotFound(filePath, identityId!, traceLogger);
    }

    const blueprintLoader = new IBlueprintLoader({ blueprintsPath: this.processorConfig.blueprintsPath });
    const blueprint = blueprintLoader.toLegacyBlueprint(loadedBlueprint);

    const request = await this.buildRequestContext({
      body,
      frontmatter,
      requestId,
      traceId,
      analysis,
      specification,
      portalKnowledge,
      memoryContext,
      traceLogger,
    });

    const taskComplexity = this.taskComplexityClassifier.classify(blueprint, request, analysis);

    const agentRunner = this.processorConfig.agentRunner;
    if (agentRunner) {
      await this.selectProvider(taskComplexity, traceId, traceLogger);
    }
    if (!agentRunner) throw new Error("RequestProcessor requires agentRunner in config");
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

  private async buildRequestContext(
    opts: {
      body: string;
      frontmatter: IRequestFrontmatter;
      requestId: string;
      traceId: string;
      analysis: IRequestAnalysis | undefined;
      specification: IRequestSpecification | undefined;
      portalKnowledge: IPortalKnowledge | undefined;
      memoryContext: EnhancedRequest | undefined;
      traceLogger: IEventLogger;
    },
  ): Promise<IParsedRequest> {
    const {
      body,
      frontmatter,
      requestId,
      traceId,
      analysis,
      specification,
      portalKnowledge,
      memoryContext,
      traceLogger,
    } = opts;
    const request = buildParsedRequest(body, frontmatter, requestId, traceId) as IParsedRequest;
    if (analysis) applyAnalysisToRequest(request, analysis);
    if (specification) {
      request.context["specification"] = JSON.parse(JSON.stringify(specification)) as IRequestContextContext;
    }
    const portalContext = await this.portalContextBuilder.buildFileContext(frontmatter.portal, traceLogger);
    if (portalContext) request.context[PORTAL_CONTEXT_KEY] = portalContext;
    if (portalKnowledge) {
      const summary = await this.portalContextBuilder.resolveKnowledgeContext(
        body,
        frontmatter.portal,
        portalKnowledge,
      );
      request.context[PORTAL_KNOWLEDGE_KEY] = summary;
    }
    if (memoryContext?.memoryContext) request.context[MEMORY_CONTEXT_KEY] = memoryContext.memoryContext;
    return request;
  }

  private async selectProvider(
    taskComplexity: string,
    traceId: string,
    traceLogger: IEventLogger,
  ): Promise<IModelProvider> {
    if (this.testProvider) {
      traceLogger.info(DomainEventType.RequestProviderSelected, "test-provider", {
        taskComplexity,
        trace_id: traceId,
      });
      return this.testProvider;
    }
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
    const selectedProvider = new CircuitBreakerProvider(rawProvider, {
      failureThreshold: 5,
      resetTimeout: 60_000,
      halfOpenSuccessThreshold: 2,
    });
    traceLogger.info(DomainEventType.RequestProviderSelected, selectedProviderName, {
      taskComplexity,
      trace_id: traceId,
      provider_wrapped: selectedProvider.id,
    });
    return selectedProvider;
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

  private async writePlanAndReturnPath(
    result: IAgentExecutionResult,
    metadata: IRequestMetadata,
    filePath: string,
    traceLogger: IEventLogger,
    extra?: Opt<LogMetadata, Reason.OptionalContext>,
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
