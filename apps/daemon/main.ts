/**
 * @module Daemon
 * @path apps/daemon/main.ts
 * @description Entry point for the Exaix daemon. Orchestrates system startup, service initialization,
 * and component lifecycle management. Handles configuration loading, database connection,
 * and signal handling for graceful shutdown.
 * @architectural-layer Application
 * @related-files ["packages/execution/src/execution_loop.ts", "../../apps/daemon/src/watcher.ts", "../../apps/exactl/src/commands/daemon_commands.ts"]
 */
import {
  DAEMON_IDENTITY_ID,
  DaemonStatus,
  DEFAULT_IDENTITIES_PATH,
  EDITION_SOLO,
  EDITION_TEAM,
  ProviderType,
} from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { ConfigService } from "@exaix/core/config";
import { FileWatcher } from "../../apps/daemon/src/watcher.ts";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ProviderFactory } from "@exaix/ai";
import { RequestProcessor } from "@exaix/request";
import { ReviewRegistry } from "@exaix/core/artifact";
import { EventLogger, EventLoggerStructuredOutput } from "@exaix/core/logger";
import { AgentRunner, ExecutionLoop } from "@exaix/execution";
import { AgentExecutorAdapter, FlowRunner, type IFlowEventLogger, type IFlowEventPayload } from "@exaix/flow";
import {
  initializeMemoryAutoApprovalMaintenance,
  MemoryAutoApprovalService,
  MemoryBankService,
  MemoryExtractorService,
  ProviderEmbeddingService,
  SessionMemoryService,
} from "@exaix/memory";
import { CostTracker, MemoryCostRouter } from "@exaix/core/cost";
import { createEmbeddingProvider } from "@exaix/ai/embeddings/embedding_provider_factory.ts";
import type { IEmbeddingProviderConfig } from "@exaix/ai/embeddings/embedding_provider_factory.ts";
import { NotificationService } from "@exaix/core/notification";
import { MemoryBankAdapter } from "../../apps/common/adapters/memory_bank_adapter.ts";
import { PortalKnowledgeService } from "@exaix/portal/knowledge";
import type { IPortalKnowledgeConfig, PortalAnalysisMode } from "@exaix/core/types";
import { createConfigReloadHandler } from "@exaix/core/config";
import { GracefulShutdown } from "./src/graceful_shutdown.ts";
import { ensureDir } from "@std/fs";
import { WaitStateSchema } from "@exaix/flow";
import { join } from "@std/path";
import { GitService } from "@exaix/git";
import type { IApplicationContext } from "@exaix/core/types";
import { type LogMetadata, toSafeJson } from "@exaix/core/types";
import { DEFAULT_MCP_IDENTITY_ID } from "@exaix/mcp";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";
import { SoloComposer } from "@exaix/core";
// Team imports — resolved unconditionally from import map;
// dead-code eliminated in Solo builds because TeamComposer/bootstrapTeamProviders
// are never called when editionType !== "team".
import { bootstrapTeamProviders, TeamComposer } from "@exaix-team/team-composer";
import { GuardrailRunner } from "@exaix-team/guardrail";

if (import.meta.main) {
  // Simple argument handling for the compiled binary
  if (Deno.args.includes("--version") || Deno.args.includes("-v")) {
    console.log("Exaix Daemon v0.1.0");
    Deno.exit(0);
  }

  try {
    // Always use EXA_CONFIG_PATH if set, and fail fast in test mode
    const configPath = Deno.env.get("EXA_CONFIG_PATH");
    if (!configPath && (Deno.env.get("EXA_TEST_CLI_MODE") === "1" || Deno.env.get("EXA_TEST_MODE") === "1")) {
      throw new Error("❌ Test mode: Configuration file not found. Set EXA_CONFIG_PATH to the ephemeral config.");
    }
    const configService = new ConfigService(configPath);
    const config = configService.get();
    const checksum = configService.getChecksum();

    // Initialize Database Service first (needed for EventLogger)
    const dbService = new DatabaseService(config);

    // Add EventLoggerStructuredOutput for TUI viewer compatibility
    const logsDir = join(config.system.root, "logs");
    const viewerLogDir = join(logsDir, "event-viewer");
    const viewerOutput = new EventLoggerStructuredOutput(viewerLogDir);

    // Create main EventLogger with database connection and viewer output
    const logger = new EventLogger({
      db: dbService,
      prefix: "",
      defaultActor: DEFAULT_MCP_IDENTITY_ID,
      outputs: [viewerOutput],
    });

    // Initialize GracefulShutdown service
    const gracefulShutdown = new GracefulShutdown(logger);

    await logger.log({
      action: DomainEventType.DaemonStarting,
      target: "exaix",
      payload: {
        config_checksum: checksum.slice(0, 8),
        root: config.system.root,
        log_level: config.system.log_level,
      },
      icon: "🚀",
    });

    await logger.info(DomainEventType.ConfigLoaded, "", {
      checksum: checksum.slice(0, 8),
      root: config.system.root,
      log_level: config.system.log_level,
    });

    await logger.info(DomainEventType.DatabaseConnected, "journal.db", { mode: "WAL" });

    // Initialize LLM Provider
    bootstrapProviderRegistry();
    // Edition-aware composer — Team edition additionally registers Team-only
    // capability modules and bootstraps Team-only providers (Vertex AI).
    const editionType = Deno.env.get("EXAIX_EDITION") ?? EDITION_SOLO;
    let _editionComposer: SoloComposer | TeamComposer;
    if (editionType === EDITION_TEAM) {
      bootstrapTeamProviders();
      _editionComposer = new TeamComposer();
    } else {
      _editionComposer = new SoloComposer();
    }
    const defaultModelName = config.agents.default_model;
    const providerInfo = ProviderFactory.getProviderInfoByName(config, defaultModelName);
    const llmProvider = await ProviderFactory.createByName(config, defaultModelName);

    await logger.info(DomainEventType.LlmProviderInitialized, providerInfo.id, {
      type: providerInfo.type,
      model: providerInfo.model,
      source: providerInfo.source,
      named_model: defaultModelName,
    });

    // Construct GuardrailRunner if enabled and Team edition (Phase 107)
    let guardrailRunner: GuardrailRunner | undefined;
    if (editionType !== EDITION_SOLO && config.guardrail?.enabled) {
      try {
        guardrailRunner = new GuardrailRunner(
          config.guardrail,
          llmProvider,
          logger,
        );
        logger.info(DomainEventType.GuardrailInitialized, "daemon", {
          policies: config.guardrail.policies.length,
        });
      } catch (err) {
        logger.error(DomainEventType.GuardrailInitFailed, "daemon", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Initialize Git orchestration service
    const gitService = new GitService({
      config,
    });

    const notificationService = new NotificationService(config, dbService);

    // Initialize Memory Services (needed for context and request processing)
    const memoryBank = new MemoryBankService(config, logger);
    const memoryAdapter = new MemoryBankAdapter(memoryBank);
    const memoryExtractor = new MemoryExtractorService(config, dbService, memoryAdapter);
    const embCfg = config.memory?.embedding;
    const providerType = embCfg?.provider ?? "ollama";
    let providerConfig: IEmbeddingProviderConfig;
    switch (providerType) {
      case ProviderType.OPENAI:
        providerConfig = { provider: ProviderType.OPENAI, apiKey: embCfg?.apiKey ?? "", model: embCfg?.model };
        break;
      case ProviderType.LLAMACPP:
        providerConfig = {
          provider: ProviderType.LLAMACPP,
          model: embCfg?.model,
          baseUrl: embCfg?.baseUrl,
          chunkSize: embCfg?.chunkSize,
        };
        break;
      default:
        providerConfig = {
          provider: ProviderType.OLLAMA,
          model: embCfg?.model,
          baseUrl: embCfg?.baseUrl,
          chunkSize: embCfg?.chunkSize,
          timeoutMs: embCfg?.timeoutMs,
        };
    }
    const embeddingProvider = createEmbeddingProvider(providerConfig);
    const costTracker = new CostTracker(dbService, config);
    const memoryCostRouter = new MemoryCostRouter(costTracker, logger);
    const providerEmbedding = new ProviderEmbeddingService(config, embeddingProvider, memoryCostRouter);

    const tieredEntriesPath = join(config.system.root, config.paths.memory, "tiered_entries.json");
    const sessionMemory = new SessionMemoryService(memoryBank, providerEmbedding, undefined, tieredEntriesPath);

    memoryBank.setEmbeddingService(providerEmbedding);

    // Initialize Portal Knowledge Service
    const pkCfg = config.portal_knowledge;
    const portalKnowledgeConfig: IPortalKnowledgeConfig = {
      autoAnalyzeOnMount: pkCfg.auto_analyze_on_mount,
      defaultMode: pkCfg.default_mode as PortalAnalysisMode,
      quickScanLimit: pkCfg.quick_scan_limit,
      maxFilesToRead: pkCfg.max_files_to_read,
      ignorePatterns: pkCfg.ignore_patterns,
      staleness: pkCfg.staleness_hours,
      useLlmInference: pkCfg.use_llm_inference,
      relevanceSearchEmbeddingEnabled: pkCfg.relevance_search_embedding_enabled ?? false,
      maxPatternDetectorSampleSize: pkCfg.max_pattern_detector_sample_size,
      minPatternDetectorSampleSize: pkCfg.min_pattern_detector_sample_size,
      enableAstAnalysis: pkCfg.enable_ast_analysis,
      enableTestExecution: pkCfg.enable_test_execution,
      enableVulnerabilityScan: pkCfg.enable_vulnerability_scan,
      enableGitHistoryAnalysis: pkCfg.enable_git_history_analysis,
      gitHistoryCommitLimit: pkCfg.git_history_commit_limit,
      gitHistorySince: pkCfg.git_history_since,
    };
    const portalKnowledge = new PortalKnowledgeService({
      config: portalKnowledgeConfig,
      memoryBank,
      embeddingProvider,
    });

    // Create central application context
    const context: IApplicationContext = {
      config: configService,
      db: dbService,
      provider: llmProvider,
      git: gitService,
      display: logger,
      notificationService,
      memoryBank,
      extractor: memoryExtractor,
      portalKnowledge,
      embeddings: providerEmbedding,
    };

    // Ensure required directories exist
    const requestsPath = join(config.system.root, config.paths.workspace, "Requests");
    const plansPath = join(config.system.root, config.paths.workspace, "Plans");
    const activePath = join(config.system.root, config.paths.workspace, "Active");
    await ensureDir(requestsPath);
    await ensureDir(plansPath);
    await ensureDir(activePath);

    // Initialize wait state storage path for clarification lifecycle
    const waitStatesRoot = join(config.system.root, config.paths.workspace, config.paths.waitStates ?? "WaitStates");

    // Create flow event logger adapter (EventLogger → IFlowEventLogger)
    const flowLogger: IFlowEventLogger = {
      log: <TEvent extends string>(event: TEvent, payload: IFlowEventPayload<TEvent>): void => {
        logger.info(event, "flow-runner", payload as Record<string, string | number | boolean | null | undefined>);
      },
    };

    // Create FlowRunner for multi-agent flow execution
    const blueprintsPath = join(config.system.root, config.paths.blueprints, DEFAULT_IDENTITIES_PATH);
    const agentRunner = new AgentRunner(llmProvider);
    const agentExecutorAdapter = new AgentExecutorAdapter(agentRunner, blueprintsPath);
    const flowRunner = new FlowRunner({
      agentExecutor: agentExecutorAdapter,
      config,
      eventLogger: flowLogger,
    });

    // Initialize Request Processor
    const requestProcessor = new RequestProcessor({
      workspacePath: join(config.system.root, config.paths.workspace),
      requestsDir: requestsPath,
      blueprintsPath: join(config.system.root, config.paths.blueprints, DEFAULT_IDENTITIES_PATH),
      includeReasoning: true,
      context, // Support unified DI
      sessionMemory,
      flowRunner,
      onClarificationCreated: async (traceId: string, _requestId: string) => {
        const waitStateId = crypto.randomUUID();
        const resumeToken = crypto.randomUUID();
        const now = new Date().toISOString();
        const waitDir = join(waitStatesRoot, traceId);
        await ensureDir(waitDir);
        const waitState = WaitStateSchema.parse({
          waitStateId,
          traceId,
          kind: "clarification",
          status: "pending",
          artifactPath: `Workspace/WaitStates/${traceId}/${waitStateId}.json`,
          resumeToken,
          createdAt: now,
          updatedAt: now,
          metadata: {},
        });
        await Deno.writeTextFile(
          join(waitDir, `${waitStateId}.json`),
          JSON.stringify(waitState, null, 2),
        );
      },
    });

    await logger.info(DomainEventType.DaemonRequestProcessorInitialized, "RequestProcessor", {
      requestsDir: requestsPath,
      blueprints: join(config.system.root, config.paths.blueprints, DEFAULT_IDENTITIES_PATH),
    });

    // Create child logger for watcher events
    const watcherLogger = logger.child({ actor: DEFAULT_MCP_IDENTITY_ID });

    // Start file watcher for new requests (Workspace/Requests)
    const requestWatcher = new FileWatcher(config, async (event) => {
      await watcherLogger.info(DomainEventType.DaemonFileDetected, event.path, {
        size: event.content.length,
      });

      // Process the request and generate a plan
      try {
        const planPath = await requestProcessor.process(event.path);
        if (planPath) {
          watcherLogger.info(DomainEventType.PlanGenerated, planPath, {
            source: event.path,
          });
        } else {
          watcherLogger.warn(DomainEventType.RequestSkipped, event.path, {
            reason: "processing returned null",
          });
        }
      } catch (error) {
        watcherLogger.error(DomainEventType.RequestFailed, event.path, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Initialize Review Registry
    const reviewRegistry = new ReviewRegistry(dbService, logger);

    const executionLoop = new ExecutionLoop({
      context,
      config,
      db: dbService,
      identityId: DAEMON_IDENTITY_ID,
      llmProvider,
      reviewRegistry,
      sessionMemory,
      guardrailRunner,
    });

    // Initialize Memory Auto-Approval Service (reuses memoryExtractor from context setup)
    const autoApprovalService = new MemoryAutoApprovalService(config, memoryExtractor);

    const { stop: stopAutoApproval } = await initializeMemoryAutoApprovalMaintenance({
      notificationService,
      memoryExtractor,
      autoApprovalService,
      logger,
      intervalMs: 60 * 60 * 1000,
      sessionMemory,
      memoryBank,
    });

    // Start file watcher for approved plans (Workspace/Active)
    // Detection for Step 5.12: Plan Execution Flow
    const planWatcher = new FileWatcher(
      config,
      async (event) => {
        // Only process plan files (_plan.md suffix)
        if (!event.path.includes("_plan.md")) {
          return;
        }

        watcherLogger.info(DomainEventType.PlanDetected, event.path, {
          size: event.content.length,
        });

        // Delegate execution to ExecutionLoop
        // It handles parsing, validation, execution, reporting, and lifecycle management (success/failure)
        const result = await executionLoop.processTask(event.path);

        if (result.success) {
          watcherLogger.info(
            "plan.execution_managed",
            event.path,
            toSafeJson({
              trace_id: result.traceId,
              status: "completed",
            }) as LogMetadata,
          );
        } else {
          watcherLogger.error(
            "plan.execution_managed_failure",
            event.path,
            toSafeJson({
              trace_id: result.traceId,
              error: result.error,
            }) as LogMetadata,
          );
        }
      },
      { customWatchPath: activePath }, // Custom watch path
    );

    // Dynamic Config Reloading (Task: Investigate missing portal logs)
    // Watch for changes to  to reload config and log changes
    const configWatcher = new FileWatcher(
      config,
      createConfigReloadHandler(configService, logger),
      {
        customWatchPath: config.system.root,
        extensions: [".toml"],
      },
    );

    // Register cleanup tasks for graceful shutdown
    gracefulShutdown.registerCleanup("stop_request_watcher", async () => {
      await requestWatcher.stop();
      await logger.info(DomainEventType.ShutdownWatchersStopped, "request and plan watchers", {});
    });

    gracefulShutdown.registerCleanup("stop_plan_watcher", async () => {
      await planWatcher.stop();
    });

    gracefulShutdown.registerCleanup("stop_config_watcher", async () => {
      await configWatcher.stop();
    });

    gracefulShutdown.registerCleanup("stop_auto_approval", async () => {
      stopAutoApproval();
      await logger.info(DomainEventType.ShutdownAutoApprovalStopped, "memory auto-approval cycle", {});
    });

    gracefulShutdown.registerCleanup("close_database", async () => {
      dbService.close();
      await logger.info(DomainEventType.ShutdownDatabaseClosed, "journal.db", {});
    });

    // Register signal handlers
    gracefulShutdown.registerSignalHandlers();

    // Register error handlers
    gracefulShutdown.registerErrorHandlers();

    await logger.log({
      action: DomainEventType.DaemonStarted,
      target: "exaix",
      payload: {
        provider: providerInfo.id,
        model: providerInfo.model,
        watching_requests: requestsPath,
        watching_plans: activePath,
        status: DaemonStatus.RUNNING,
      },
      icon: "✅",
    });

    // Start watching directories
    await Promise.all([
      requestWatcher.start(),
      planWatcher.start(),
      configWatcher.start(),
    ]);
  } catch (error) {
    console.error("❌ Fatal Error:", error);
    Deno.exit(1);
  }
}
