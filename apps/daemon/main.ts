/**
 * @module Daemon
 * @path apps/daemon/main.ts
 * @description Entry point for the Exaix daemon. Orchestrates system startup, service initialization,
 * and component lifecycle management. Handles configuration loading, database connection,
 * and signal handling for graceful shutdown.
 * @architectural-layer Application
 * @related-files ["packages/execution/src/execution_loop.ts", "../../src/services/utils/watcher.ts", "../../apps/exactl/src/commands/daemon_commands.ts"]
 */
import { ConfigService } from "@exaix/core/config";
import { DAEMON_IDENTITY_ID, DaemonStatus, DEFAULT_IDENTITIES_PATH, type LogLevel } from "@exaix/core";
import { FileWatcher } from "../../src/services/utils/watcher.ts";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ProviderFactory } from "@exaix/ai";
import { RequestProcessor } from "@exaix/request";
import { ReviewRegistry } from "@exaix/core/artifact";
import { EventLogger } from "@exaix/core/logger";
import { ExecutionLoop } from "@exaix/execution";
import {
  initializeMemoryAutoApprovalMaintenance,
  MemoryAutoApprovalService,
  MemoryBankService,
  MemoryExtractorService,
} from "@exaix/memory";
import { NotificationService } from "@exaix/core/notification";
import { MemoryBankAdapter } from "../../src/services/adapters/memory_bank_adapter.ts";
import { createConfigReloadHandler } from "@exaix/core/config";
import { ConsoleOutput, FileOutput, getGlobalLogger, initializeGlobalLogger, logInfo } from "@exaix/core/logger";
import { GracefulShutdown } from "./src/graceful_shutdown.ts";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import type { ILogOutput } from "@exaix/core/types";
import { type LogMetadata, toSafeJson } from "@exaix/core/types";
import { GitService } from "@exaix/git";
import type { IApplicationContext } from "@exaix/core/types";
import { DEFAULT_MCP_IDENTITY_ID } from "@exaix/mcp";
import { bootstrapProviderRegistry } from "../../src/ai/registry_bootstrap.ts";

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

    // Create main EventLogger with database connection
    const logger = new EventLogger({
      db: dbService,
      prefix: "",
      defaultActor: DEFAULT_MCP_IDENTITY_ID,
    });

    // Initialize StructuredLogger for audit and performance tracking
    const logsDir = join(config.system.root, "logs");
    const structuredLogsDir = join(logsDir, "structured");

    const structuredOutputs: ILogOutput[] = [new FileOutput(structuredLogsDir)];

    // Add console output for debug level to help with development
    if (config.system.log_level === "debug") {
      structuredOutputs.unshift(new ConsoleOutput());
    }

    initializeGlobalLogger({
      minLevel: config.system.log_level as LogLevel,
      outputs: structuredOutputs,
      enablePerformanceTracking: true,
      serviceName: "exaix-daemon",
      version: config.system.version,
    });

    // Initialize GracefulShutdown service
    const gracefulShutdown = new GracefulShutdown(getGlobalLogger());

    await logger.log({
      action: "daemon.starting",
      target: "exaix",
      payload: {
        config_checksum: checksum.slice(0, 8),
        root: config.system.root,
        log_level: config.system.log_level,
      },
      icon: "🚀",
    });

    // Log daemon startup as audit event
    logInfo(
      "Exaix daemon starting",
      toSafeJson({
        audit_event: true,
        event_type: "daemon_startup",
        config_checksum: checksum.slice(0, 8),
        root: config.system.root,
        log_level: config.system.log_level,
        service: "exaix-daemon",
        version: config.system.version,
      }) as LogMetadata,
    );

    await logger.info("config.loaded", "exa.config.toml", {
      checksum: checksum.slice(0, 8),
      root: config.system.root,
      log_level: config.system.log_level,
    });

    await logger.info("database.connected", "journal.db", { mode: "WAL" });

    // Initialize LLM Provider
    bootstrapProviderRegistry();
    const defaultModelName = config.agents.default_model;
    const providerInfo = ProviderFactory.getProviderInfoByName(config, defaultModelName);
    const llmProvider = await ProviderFactory.createByName(config, defaultModelName);

    await logger.info("llm.provider.initialized", providerInfo.id, {
      type: providerInfo.type,
      model: providerInfo.model,
      source: providerInfo.source,
      named_model: defaultModelName,
    });

    // Initialize Git orchestration service
    const gitService = new GitService({
      config,
      db: dbService,
    });

    const notificationService = new NotificationService(config, dbService);

    // Create central application context
    const context: IApplicationContext = {
      config: configService,
      db: dbService,
      provider: llmProvider,
      git: gitService,
      display: logger,
      notificationService,
    };

    // Ensure required directories exist
    const requestsPath = join(config.system.root, config.paths.workspace, "Requests");
    const plansPath = join(config.system.root, config.paths.workspace, "Plans");
    const activePath = join(config.system.root, config.paths.workspace, "Active");
    await ensureDir(requestsPath);
    await ensureDir(plansPath);
    await ensureDir(activePath);

    // Initialize Request Processor
    const requestProcessor = new RequestProcessor({
      workspacePath: join(config.system.root, config.paths.workspace),
      requestsDir: requestsPath,
      blueprintsPath: join(config.system.root, config.paths.blueprints, DEFAULT_IDENTITIES_PATH),
      includeReasoning: true,
      context, // Support unified DI
    });

    await logger.info("request_processor.initialized", "RequestProcessor", {
      requestsDir: requestsPath,
      blueprints: join(config.system.root, config.paths.blueprints, DEFAULT_IDENTITIES_PATH),
    });

    // Create child logger for watcher events
    const watcherLogger = logger.child({ actor: DEFAULT_MCP_IDENTITY_ID });

    // Start file watcher for new requests (Workspace/Requests)
    const requestWatcher = new FileWatcher(config, async (event) => {
      await watcherLogger.info("file.detected", event.path, {
        size: event.content.length,
      });

      // Process the request and generate a plan
      try {
        const planPath = await requestProcessor.process(event.path);
        if (planPath) {
          watcherLogger.info("plan.generated", planPath, {
            source: event.path,
          });
        } else {
          watcherLogger.warn("request.skipped", event.path, {
            reason: "processing returned null",
          });
        }
      } catch (error) {
        watcherLogger.error("request.failed", event.path, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Initialize Review Registry
    const reviewRegistry = new ReviewRegistry(dbService, logger);

    const executionLoop = new ExecutionLoop({
      context, // Preferred unified DI
      config,
      db: dbService,
      identityId: DAEMON_IDENTITY_ID,
      llmProvider,
      reviewRegistry,
    });

    // Initialize Memory Auto-Approval Service
    const memoryBank = new MemoryBankService(config, dbService);
    const memoryAdapter = new MemoryBankAdapter(memoryBank);
    const memoryExtractor = new MemoryExtractorService(config, dbService, memoryAdapter);
    const autoApprovalService = new MemoryAutoApprovalService(config, memoryExtractor);

    const { stop: stopAutoApproval } = await initializeMemoryAutoApprovalMaintenance(
      notificationService,
      memoryExtractor,
      autoApprovalService,
      logger,
      60 * 60 * 1000,
    );

    // Start file watcher for approved plans (Workspace/Active)
    // Detection for Step 5.12: Plan Execution Flow
    const planWatcher = new FileWatcher(
      config,
      async (event) => {
        // Only process plan files (_plan.md suffix)
        if (!event.path.includes("_plan.md")) {
          return;
        }

        watcherLogger.info("plan.detected", event.path, {
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
    // Watch for changes to exa.config.toml to reload config and log changes
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
      await logger.info("shutdown.watchers_stopped", "request and plan watchers", {});
    });

    gracefulShutdown.registerCleanup("stop_plan_watcher", async () => {
      await planWatcher.stop();
    });

    gracefulShutdown.registerCleanup("stop_config_watcher", async () => {
      await configWatcher.stop();
    });

    gracefulShutdown.registerCleanup("stop_auto_approval", async () => {
      stopAutoApproval();
      await logger.info("shutdown.auto_approval_stopped", "memory auto-approval cycle", {});
    });

    gracefulShutdown.registerCleanup("close_database", async () => {
      dbService.close();
      await logger.info("shutdown.database_closed", "journal.db", {});
    });

    // Register signal handlers
    gracefulShutdown.registerSignalHandlers();

    // Register error handlers
    gracefulShutdown.registerErrorHandlers();

    await logger.log({
      action: "daemon.started",
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
