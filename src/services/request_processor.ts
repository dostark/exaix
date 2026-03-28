/**
 * @module RequestProcessor
 * @path src/services/request_processor.ts
 * @description Validates incoming request files, determines routing strategies (Agent vs Flow),
 * and generates execution plans. Acts as the primary entry point for the "Request Processing" phase.
 * @architectural-layer Services
 * @dependencies [DatabaseService, PlanWriter, AgentRunner, BlueprintLoader, ProviderRegistry, RequestStatus, RequestParser, StatusManager, RequestProcessingTypes]
 * @related-files [src/services/request_router.ts, src/services/agent_runner.ts, src/services/plan_writer.ts, src/services/request_processing/request_parser.ts, src/services/request_processing/status_manager.ts]
 */

import { basename, dirname, join } from "@std/path";
import { IModelProvider } from "../ai/types.ts";
import type { DatabaseService } from "./db.ts";
import type { Config } from "../shared/schemas/config.ts";
import {
  AgentRunner,
  type IAgentExecutionResult,
  type IBlueprint,
  type IParsedRequest,
  type IRequestContextContext,
} from "./agent_runner.ts";
import { applyAnalysisToRequest, buildParsedRequest } from "./request_common.ts";
import { BlueprintLoader, type ILoadedBlueprint } from "./blueprint_loader.ts";
import { type IRequestMetadata, PlanWriter } from "./plan_writer.ts";
import { PlanValidationError } from "./plan_adapter.ts";
import { RequestStatus } from "../shared/status/request_status.ts";
import { PlanStatus } from "../shared/status/plan_status.ts";
import {
  COMPLEXITY_BODY_LENGTH_LOW,
  COMPLEXITY_BULLET_THRESHOLD_HIGH,
  COMPLEXITY_FILE_REF_PATTERN,
  COMPLEXITY_FILE_REF_THRESHOLD_HIGH,
  DEFAULT_ANALYZER_MODE,
  DEFAULT_MCP_VERSION,
  MEMORY_CONTEXT_KEY,
  PORTAL_CONTEXT_KEY,
  PORTAL_KNOWLEDGE_KEY,
  PORTAL_KNOWLEDGE_PROMPT_MAX_LINES,
} from "../shared/constants.ts";
import type { IPortalKnowledgeService } from "../shared/interfaces/i_portal_knowledge_service.ts";
import type { IPortalKnowledge } from "../shared/schemas/portal_knowledge.ts";
import { buildPortalContextBlock } from "./prompt_context.ts";
import { EventLogger } from "./event_logger.ts";
import { FlowValidatorImpl } from "./flow_validator.ts";
import { ProviderFactory } from "../ai/provider_factory.ts";
import { ProviderSelector } from "../ai/provider_selector.ts";
import { ProviderRegistry } from "../ai/provider_registry.ts";
import { CostTracker } from "./cost_tracker.ts";
import { HealthCheckService } from "./health_check_service.ts";
import { CircuitBreaker, CircuitBreakerProvider } from "../ai/circuit_breaker.ts";
import { LogMethod } from "./decorators/logging.ts";
import { RequestParser } from "./request_processing/request_parser.ts";
import { StatusManager } from "./request_processing/status_manager.ts";
import { IRequestFrontmatter, ParsedRequestFile } from "./request_processing/types.ts";
import { OutputValidator } from "./output_validator.ts";
import type { LogMetadata } from "../shared/types/json.ts";
import { MiddlewarePipeline } from "./middleware/pipeline.ts";
import { IServiceContext } from "./common/types.ts";
import { RequestAnalyzer, saveAnalysis } from "./request_analysis/mod.ts";
import { type IRequestAnalysis, RequestAnalysisComplexity } from "../shared/schemas/request_analysis.ts";
import { IRequestAnalyzerService } from "../shared/interfaces/i_request_analyzer_service.ts";
import { RequestKind, TaskComplexity } from "../shared/enums.ts";

import { AnalysisMode } from "../shared/types/request.ts";
import type { IRequestQualityGateService } from "../shared/interfaces/i_request_quality_gate_service.ts";
import { buildQualityGateConfig, RequestQualityGate } from "./quality_gate/request_quality_gate.ts";
import { RequestQualityRecommendation } from "../shared/schemas/request_quality_assessment.ts";
import { loadClarification, saveClarification } from "./quality_gate/clarification_persistence.ts";
import { ClarificationSessionStatus } from "../shared/schemas/clarification_session.ts";
import type { IRequestSpecification } from "../shared/schemas/request_specification.ts";
import { type EnhancedRequest, SessionMemoryService } from "./session_memory.ts";

export interface IRequestProcessingContext extends IServiceContext {
  filePath: string;
  parsed: ParsedRequestFile;
  frontmatter: IRequestFrontmatter;
  body: string;
  traceLogger: EventLogger;
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
}

// ============================================================================
// RequestProcessor Implementation
// ============================================================================

export class RequestProcessor {
  private readonly planWriter: PlanWriter;
  private readonly plansDir: string;
  private readonly logger: EventLogger;
  private readonly flowValidator: FlowValidatorImpl | null;
  private readonly providerSelector: ProviderSelector;
  private readonly costTracker: CostTracker;
  private readonly ioBreaker: CircuitBreaker;
  private readonly requestParser: RequestParser;
  private readonly statusManager: StatusManager;
  private readonly analyzer: IRequestAnalyzerService;
  private readonly qualityGate?: IRequestQualityGateService;

  constructor(
    private readonly config: Config,
    private readonly db: DatabaseService,
    private readonly processorConfig: IRequestProcessorConfig,
    private readonly testProvider?: IModelProvider,
    costTracker?: CostTracker,
    testAnalyzer?: IRequestAnalyzerService,
    private readonly portalKnowledgeService?: IPortalKnowledgeService,
    testQualityGate?: IRequestQualityGateService,
    private readonly sessionMemory?: SessionMemoryService,
  ) {
    // Initialize services
    this.costTracker = costTracker ?? new CostTracker(db, config);
    const healthChecker = new HealthCheckService(DEFAULT_MCP_VERSION, config);
    this.providerSelector = new ProviderSelector(
      ProviderRegistry,
      this.costTracker,
      healthChecker,
    );

    this.logger = new EventLogger({
      db,
      defaultActor: "agent:request-processor",
    });

    this.plansDir = join(config.system.root, config.paths.workspace, "Plans");
    this.planWriter = new PlanWriter({
      plansDirectory: this.plansDir,
      includeReasoning: processorConfig.includeReasoning,
      generateWikiLinks: true,
      runtimeRoot: join(config.system.root, config.paths.runtime),
      db,
    });

    this.flowValidator = null; // Temporary for testing

    this.ioBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 60_000,
      halfOpenSuccessThreshold: 2,
    });

    // Initialize extracted components
    this.requestParser = new RequestParser(this.logger);
    this.statusManager = new StatusManager(this.logger);
    this.analyzer = testAnalyzer ?? new RequestAnalyzer({
      mode: (config.request_analysis?.mode ?? DEFAULT_ANALYZER_MODE) as AnalysisMode,
      actionabilityThreshold: config.request_analysis?.actionability_threshold,
      inferAcceptanceCriteria: config.request_analysis?.infer_acceptance_criteria,
    });

    // Wire QualityGate with Provider and OutputValidator (Phase 51)
    const qgConfig = buildQualityGateConfig(config.quality_gate ?? {});

    this.qualityGate = testQualityGate;
    if (!this.qualityGate) {
      this.qualityGate = new RequestQualityGate(
        qgConfig,
        this.testProvider,
        new OutputValidator(),
        this.logger,
      );
    }
  }

  @LogMethod(new EventLogger({ prefix: "[RequestProcessor]" }), "request.process")
  async process(filePath: string): Promise<string | null> {
    const parsed = await this.requestParser.parse(filePath);
    if (!parsed) {
      return null;
    }

    const { frontmatter, body } = parsed;
    const traceId = frontmatter.trace_id;
    const requestId = basename(filePath, ".md");
    const traceLogger = this.logger.child({ traceId });

    traceLogger.info("request.processing", filePath, {
      flow: frontmatter.flow ?? null,
      agent: frontmatter.identity ?? null,
      priority: frontmatter.priority ?? null,
    });

    if (this.shouldSkipRequest(frontmatter, traceLogger, filePath)) {
      traceLogger.info("request.skipped", filePath, {
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
      : await this._runQualityGate(body, filePath, requestId, traceLogger);
    if (qgOutcome.earlyReturn) {
      return null;
    }
    const assessedBody = qgOutcome.enrichedBody ?? body;
    const clarificationSpec = qgOutcome.specification;

    const pipeline = this.createRequestProcessingPipeline();

    // Enhance request with session memory context before analysis
    const memoryContext = this.sessionMemory
      ? await this.sessionMemory.enhanceRequest(assessedBody).catch(() => undefined)
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
    traceLogger: EventLogger,
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
        await this.statusManager.updateStatus(filePath, RequestStatus.REFINING);
        try {
          const session = await this.qualityGate.startClarification(requestId, body);
          await saveClarification(filePath, session);
        } catch {
          // Session start failed; REFINING status is preserved, return early anyway
        }
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
      traceLogger.warn("request.quality_gate.failed", filePath, { requestId });
    }
    return { earlyReturn: false };
  }

  private shouldSkipRequest(frontmatter: IRequestFrontmatter, _traceLogger: EventLogger, _filePath: string): boolean {
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
    traceLogger: EventLogger;
  }): Promise<RequestKind | null> {
    const { frontmatter, filePath, traceLogger } = args;

    const hasFlow = !!frontmatter.flow;
    const hasAgent = !!frontmatter.identity || !!frontmatter.identity;

    if (hasFlow && hasAgent) {
      traceLogger.error("request.invalid", filePath, {
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
      traceLogger.error("request.invalid", filePath, {
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
          ctx.traceLogger?.error("request.processing.error", ctx.filePath, {
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
        ctx.traceLogger?.info("request.processing.duration", ctx.filePath, { duration_ms: duration });
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
    traceLogger: EventLogger,
    analysis?: IRequestAnalysis,
    portalKnowledge?: IPortalKnowledge,
    specification?: IRequestSpecification,
    memoryContext?: EnhancedRequest,
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
    traceLogger: EventLogger,
    analysis?: IRequestAnalysis,
    _portalKnowledge?: IPortalKnowledge,
  ): Promise<string | null> {
    if (this.flowValidator) {
      const validation = await this.flowValidator.validateFlow(frontmatter.flow!);
      if (!validation.valid) {
        traceLogger.error("flow.validation.failed", frontmatter.flow!, {
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

  private async processAgentRequest(
    frontmatter: IRequestFrontmatter,
    body: string,
    filePath: string,
    requestId: string,
    traceId: string,
    traceLogger: EventLogger,
    analysis?: IRequestAnalysis,
    portalKnowledge?: IPortalKnowledge,
    specification?: IRequestSpecification,
    memoryContext?: EnhancedRequest,
  ): Promise<string | null> {
    const identityId = frontmatter.identity || frontmatter.identity;
    const loadedBlueprint = await this.loadBlueprintWithFallback(identityId!, traceLogger);

    if (!loadedBlueprint) {
      return this.handleBlueprintNotFound(filePath, identityId!, traceLogger);
    }

    const blueprintLoader = new BlueprintLoader({ blueprintsPath: this.processorConfig.blueprintsPath });
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
      request.context[PORTAL_KNOWLEDGE_KEY] = buildPortalKnowledgeSummary(portalKnowledge);
    }
    if (memoryContext) {
      request.context[MEMORY_CONTEXT_KEY] = memoryContext;
    }

    const taskComplexity = this.classifyTaskComplexity(blueprint, request, analysis);
    let selectedProvider: IModelProvider;

    if (this.testProvider) {
      selectedProvider = this.testProvider;
      traceLogger.info("provider.selected", "test-provider", {
        taskComplexity,
        trace_id: traceId,
      });
    } else {
      let selectedProviderName: string;
      try {
        selectedProviderName = await this.providerSelector.selectProviderForTask(
          this.config,
          taskComplexity,
        );
      } catch (selErr) {
        traceLogger.warn("provider.selection_failed", String(selErr), { fallback: "mock" });
        selectedProviderName = "mock";
      }

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

      traceLogger.info("provider.selected", selectedProviderName, {
        taskComplexity,
        trace_id: traceId,
        provider_wrapped: selectedProvider.id,
      });
    }

    const agentRunner = new AgentRunner(selectedProvider, { db: this.db });
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
      subjectIsFallback: frontmatter.subject_is_fallback,
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
          traceLogger.info("plan.validation.retry", requestId, {
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

  private async handleBlueprintNotFound(
    filePath: string,
    identityId: string,
    traceLogger: EventLogger,
  ): Promise<string | null> {
    traceLogger.error("blueprint.not_found", identityId, { request: filePath });
    await this.statusManager.updateStatus(filePath, RequestStatus.FAILED, `Blueprint not found: ${identityId}`);
    traceLogger.error("request.failed", filePath, { error: `Blueprint not found: ${identityId}` });
    return null;
  }

  private async loadBlueprintWithFallback(
    identityId: string,
    traceLogger: EventLogger,
  ): Promise<ILoadedBlueprint | null> {
    const blueprintLoader = new BlueprintLoader({ blueprintsPath: this.processorConfig.blueprintsPath });
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
    traceLogger: EventLogger,
  ): Promise<ILoadedBlueprint | null> {
    let dir = Deno.cwd();
    while (true) {
      const candidatePath = join(dir, "Blueprints", "Identities");
      try {
        const candidateFile = join(candidatePath, `${identityId}.md`);
        try {
          const stat = await Deno.stat(candidateFile);
          if (stat && stat.isFile) {
            const fallbackLoader = new BlueprintLoader({ blueprintsPath: candidatePath });
            const loadedBlueprint = await fallbackLoader.load(identityId);
            if (loadedBlueprint) {
              traceLogger.info("blueprint.loaded_fallback", identityId, { from: candidatePath });
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
    traceLogger: EventLogger,
  ): Promise<ILoadedBlueprint | null> {
    // Try the repository root (cwd) directly
    const repoIdentitiesPath = join(Deno.cwd(), "Blueprints", "Identities");
    const fallbackLoader = new BlueprintLoader({ blueprintsPath: repoIdentitiesPath });
    const loadedBlueprint = await fallbackLoader.load(identityId);
    if (loadedBlueprint) {
      traceLogger.info("blueprint.loaded_fallback", identityId, { from: repoIdentitiesPath });
      return loadedBlueprint;
    }

    // Also try locating Blueprints relative to this module (repo root)
    try {
      const repoRoot = join(dirname(dirname(dirname(new URL(import.meta.url).pathname))));
      const repoModuleIdentities = join(repoRoot, "Blueprints", "Identities");
      const moduleLoader = new BlueprintLoader({ blueprintsPath: repoModuleIdentities });
      const moduleLoaded = await moduleLoader.load(identityId);
      if (moduleLoaded) {
        traceLogger.info("blueprint.loaded_fallback", identityId, { from: repoModuleIdentities });
        return moduleLoaded;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async handleError(
    error: unknown,
    filePath: string,
    requestId: string,
    traceLogger: EventLogger,
    frontmatter?: IRequestFrontmatter,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    let persistedRejectedPath = false;
    if (error instanceof PlanValidationError) {
      const validationError = error;
      const rawDetails = validationError.details?.rawContent;
      const fullRawResponse = validationError.details?.fullRawResponse;

      traceLogger.info("plan.validation.error.detected", requestId, {
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
        traceLogger.info("plan.saved_rejected", rejectedPath, { reason: "validation_failed" });

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
        traceLogger.warn("plan.save_rejected_failed", filePath, { error: String(writeErr) });
      }
    }

    traceLogger.error("request.failed", filePath, {
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
    validationError: unknown;
  }): string {
    return `---
trace_id: "${args.traceId ?? "unknown"}"
request_id: "${args.requestId}"
status: ${PlanStatus.REJECTED}
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
    traceLogger: EventLogger,
    extra?: LogMetadata,
  ): Promise<string> {
    const planResult = await this.ioBreaker.execute(() => this.planWriter.writePlan(result, metadata));

    // Update request status and potentially "upgrade" the subject if agent suggested a better one
    const extraRequestFields: Record<string, string> = {};
    if (planResult.subject && planResult.subject !== metadata.subject) {
      extraRequestFields.subject = planResult.subject;
    }

    await this.statusManager.updateStatus(filePath, RequestStatus.PLANNED, undefined, extraRequestFields);

    const logObj: LogMetadata = { plan_path: planResult.planPath, ...(extra ?? {}) };
    traceLogger.info("request.planned", filePath, logObj);
    return planResult.planPath;
  }

  private classifyTaskComplexity(
    blueprint: IBlueprint,
    request: IParsedRequest,
    analysis?: IRequestAnalysis,
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
    }
  }

  private checkContentHeuristics(body?: string): TaskComplexity | null {
    if (!body) return null;
    const fileRefs = body.match(COMPLEXITY_FILE_REF_PATTERN);
    if (fileRefs && fileRefs.length >= COMPLEXITY_FILE_REF_THRESHOLD_HIGH) return TaskComplexity.COMPLEX;
    const bulletPoints = (body.match(/\n\s*[-*]\s+/g) || []).length;
    if (bulletPoints >= COMPLEXITY_BULLET_THRESHOLD_HIGH) return TaskComplexity.COMPLEX;
    if (body.length < COMPLEXITY_BODY_LENGTH_LOW && !body.includes("\n-")) return TaskComplexity.SIMPLE;
    return null;
  }

  private classifyByAgentId(identityId?: string): TaskComplexity {
    const id = identityId || "";
    if (id.includes("analyzer") || id.includes("summarizer")) return TaskComplexity.SIMPLE;
    if (id.includes("coder") || id.includes("planner") || id.includes("architect")) {
      return TaskComplexity.COMPLEX;
    }
    return TaskComplexity.MEDIUM;
  }

  private async buildPortalContext(portalAlias?: string, traceLogger?: EventLogger): Promise<string | null> {
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
  ) {
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
  maxLines = PORTAL_KNOWLEDGE_PROMPT_MAX_LINES,
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
