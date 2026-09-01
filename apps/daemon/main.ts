/**
 * @module Daemon
 * @path apps/daemon/main.ts
 * @description Entry point for the Exaix daemon. Orchestrates system startup, service initialization,
 * and component lifecycle management. Handles configuration loading, database connection,
 * and signal handling for graceful shutdown.
 * @architectural-layer Application
 * @related-files ["packages/execution/src/execution_loop.ts", "../../apps/daemon/src/watcher.ts", "../../apps/exactl/src/commands/daemon_commands.ts", "packages/ai/src/model_resolver.ts"]
 * @phase-134 Step 2 production call-site: injects the edition-selected IModelRegistry (DefaultModelRegistry floor in Solo) into ModelResolver.
 */
import {
  DAEMON_DEFAULT_NET_HOSTS,
  DAEMON_IDENTITY_ID,
  DaemonStatus,
  DEFAULT_IDENTITIES_PATH,
  DEFAULT_PROJECTS_MEMORY_PATH,
  EDITION_SOLO,
  EDITION_TEAM,
  ProviderType,
  scrubProcessEnv,
  SwapClass,
} from "@exaix/core";
import { Database } from "@db/sqlite";
import { DomainEventType } from "@exaix/core/events";
import {
  ConfigService,
  DaemonConfigAdapter,
  ensureConfigDb,
  getAllEffectiveValues,
  getRegisteredDefaults,
  InMemoryConfigStore,
  migrateConfigDb,
  seedConfigDb,
} from "@exaix/core/config";
import { evaluateNetPolicy } from "@exaix/core/security";
import { PlanAmendmentGate, PlanAmendmentService } from "@exaix/core/planning";
import { FileWatcher } from "../../apps/daemon/src/watcher.ts";
import { DatabaseService } from "@exaix/storage-sqlite";
import {
  DEFAULT_FIXTURE_DRIFT_RECAPTURE_THRESHOLD,
  DefaultRoutingStrategy,
  type IProviderHealthChecker,
  type IResolutionStrategy,
  ModelResolver,
  ProviderFactory,
  ProviderRegistry,
} from "@exaix/ai";
import { MockLLMProvider, unwrapModelProvider } from "@exaix/ai/providers";
import type { Opt, Reason } from "@exaix/core/types";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { RequestProcessor } from "@exaix/request";
import { ReviewRegistry } from "@exaix/core/artifact";
import { EventLogger, EventLoggerStructuredOutput } from "@exaix/core/logger";
import { AgentRunner, ExecutionLoop } from "@exaix/execution";
import { initializeHealthChecks } from "@exaix/core/health";
import { buildMilestoneEmitterFromConfig } from "@exaix/core/observability";
import {
  AgentOrchestratorAdapter,
  createJudgeEvaluator,
  FlowLoader,
  FlowRunner,
  FlowTraceStore,
  GateEvaluator,
  PlanContextResolver,
} from "@exaix/flow";
import {
  initializeMemoryAutoApprovalMaintenance,
  LearningContradictionResolver,
  LlmLearningExtractor,
  MemoryAutoApprovalService,
  MemoryBankService,
  MemoryExtractorService,
  MemoryReflectionService,
  ProviderEmbeddingService,
  SessionMemoryService,
} from "@exaix/memory";
import { CostTracker, MemoryCostRouter } from "@exaix/core/cost";
import { createMemoryEmbeddingProvider } from "../common/embedding_provider_bootstrap.ts";
import { NotificationService } from "@exaix/core/notification";
import { SkillsService } from "@exaix/core/skills";
import { FlowLoaderAdapter } from "../../apps/common/adapters/flow_loader_adapter.ts";
import { MemoryBankAdapter } from "../../apps/common/adapters/memory_bank_adapter.ts";
import {
  createDefaultSymbolExtractorRegistry,
  type ISymbolExtractorRegistry,
  PortalKnowledgeService,
} from "@exaix/portal/knowledge";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import type { IPortalKnowledgeConfig, PortalAnalysisMode } from "@exaix/core/types";
import { createConfigReloadHandler, createDbWatcherHandler, getMaxOverrideId } from "@exaix/core/config";
import { GracefulShutdown } from "./src/graceful_shutdown.ts";
import { createFlowEventLogger } from "./src/flow_event_logger_adapter.ts";
import { JudgeAgentRunner } from "./src/judge_agent_runner.ts";
import { recoverOrphanedDelegations } from "./src/recovery.ts";
import { buildTeamMcpClient } from "./src/build_team_mcp_client.ts";
// registerTeamCapabilities is loaded dynamically inside the Team branch only —
// bootstrap_team.ts statically pulls in @exaix-team/voting|hitl|portal-extractors,
// which must stay out of the Solo binary.
import { ensureDir } from "@std/fs";
import { WaitStateSchema } from "@exaix/flow";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import type { EffortTier, ModelSize } from "@exaix/schemas";
import type { JSONValue } from "@exaix/core/types";
import { GitService } from "@exaix/git";
import { HnswVectorIndex } from "@exaix/memory";
import { ToolRegistry } from "@exaix/tool-runtime";
import type { IApplicationContext } from "@exaix/core/types";
import { type LogMetadata, toSafeJson } from "@exaix/core/types";
import { DEFAULT_MCP_IDENTITY_ID, DYNAMIC_MODE_APPROVAL_TOOLS, DYNAMIC_MODE_TOOLS } from "@exaix/mcp";
import type { LocalToolDispatcher } from "@exaix/mcp/server";
import { SessionWaitStore } from "@exaix/session/wait/session_wait_store.ts";
import { SessionReturnProcessor } from "@exaix/session/session_return_processor.ts";
import { SessionDelegationResultStore } from "@exaix/session/session_delegation_result_store.ts";
import { SessionBriefReader } from "@exaix/session/session_brief_reader.ts";
import { SessionReturnWatcher } from "./src/session_return_watcher.ts";
import { HeadlessSessionLauncher } from "./src/headless_session_launcher.ts";
import { createOnReconciledHandler } from "./src/on_reconciled_dispatcher.ts";
import {
  createCodeChangesDelegateAdapter,
  SessionDelegationCoordinator,
} from "./src/session_delegation_coordinator.ts";
import { SessionDelegateService } from "@exaix/session/session_delegate_service.ts";
import { SessionDelegateCycleClaimStore } from "@exaix/session/session_delegate_cycle_claim_store.ts";
import { SessionDelegateCycleStore } from "@exaix/session/session_delegate_cycle_store.ts";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import type { SessionGate, SessionTool } from "@exaix/schemas/session_delegate.ts";
import type { ISessionLaunch } from "@exaix/session/i_session_adapter.ts";
import {
  CONFIG_INTEGRITY_POLL_INTERVAL_MS,
  DEFAULT_CONFIG_DB_POLL_INTERVAL_MS,
  DEFAULT_REQUESTS_PATH,
  SESSION_BIN_CLAUDE_CODE,
  SESSION_BIN_CODEX,
  SESSION_BIN_CURSOR,
  SESSION_BIN_OPENCODE,
  SESSION_BIN_VSCODE,
} from "@exaix/core/types/constants.ts";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";
import { SoloComposer } from "@exaix/core/composer";
// Team modules load dynamically only inside non-Solo branches — a static top-level import
// would be bundled into the Solo binary by `deno compile`, defeating edition separation.
// Type-only imports are erased at compile time and stay safe as statics.
import type { TeamComposer } from "@exaix-team/team-composer";
import type { GuardrailRunner } from "@exaix-team/guardrail";
import type { HitlPolicyEvaluator } from "@exaix-team/hitl";

/** LRU cache for traceId → resolved model string (PG-6 remediation). */
const traceModelCache = new Map<string, string>();
const TRACE_CACHE_MAX = 100;

/** Representative migrated config key resolved through `configAdapter` at boot; its journalled provenance proves the cutover read path works end-to-end. */
const CONFIG_CUTOVER_PROBE_KEY = "ai.timeout_ms";

/** Resolves a request file's IModelIntent (model_size, thinking, effort, etc.) via ModelResolver. Returns "provider:model", or undefined if the file lacks intent fields or can't be read. */
async function resolveRequestModel(
  filePath: string,
  resolver: ModelResolver,
): Promise<string | undefined> {
  try {
    const content = await Deno.readTextFile(filePath);
    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!yamlMatch) return undefined;
    const fm = parseYaml(yamlMatch[1]) as Record<string, JSONValue>;
    if (!fm.model_size && !fm.model) return undefined;
    const intent: Parameters<ModelResolver["resolve"]>[0] = {
      model: fm.model as string | undefined,
      model_size: fm.model_size as ModelSize | undefined,
      thinking: fm.thinking as boolean | undefined,
      effort: fm.effort as EffortTier | undefined,
      characteristics: fm.characteristics as string[] | undefined,
      preferred_provider: fm.preferred_provider as string | undefined,
    };
    const resolved = await resolver.resolve(intent);
    return `${resolved.provider}:${resolved.model}`;
  } catch {
    return undefined;
  }
}

async function resolveModelFromTrace(
  traceId: string,
  requestsDir: string,
  resolver: ModelResolver,
): Promise<string | undefined> {
  const cached = traceModelCache.get(traceId);
  if (cached) return cached;

  try {
    for await (const entry of Deno.readDir(requestsDir)) {
      if (!entry.name.endsWith(".md")) continue;
      const content = await Deno.readTextFile(join(requestsDir, entry.name));
      const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!yamlMatch) continue;
      const fm = parseYaml(yamlMatch[1]) as Record<string, JSONValue>;
      if (fm.trace_id === traceId) {
        const result = await resolveRequestModel(join(requestsDir, entry.name), resolver);
        if (result) {
          if (traceModelCache.size >= TRACE_CACHE_MAX) {
            const firstKey = traceModelCache.keys().next().value;
            if (firstKey) traceModelCache.delete(firstKey);
          }
          traceModelCache.set(traceId, result);
        }
        return result;
      }
    }
  } catch {
    // requests directory doesn't exist or not accessible
  }
  return undefined;
}

if (import.meta.main) {
  // Scrub ambient injection-class env vars (LD_*, NODE_OPTIONS, git env-config, …) before
  // any service init or spawn path reads the env — the daemon's shell may export them for
  // unrelated toolchains, and every spawned child would otherwise inherit them.
  scrubProcessEnv();

  // Simple argument handling for the compiled binary
  if (Deno.args.includes("--version") || Deno.args.includes("-v")) {
    console.log("Exaix Daemon v0.1.0");
    Deno.exit(0);
  }

  try {
    // Always use EXA_CONFIG_PATH if set, and fail fast in test mode
    const configPath = Deno.env.get("EXA_CONFIG_PATH");
    if (
      !configPath &&
      (Deno.env.get("EXA_TEST_CLI_MODE") === "1" ||
        Deno.env.get("EXA_TEST_MODE") === "1")
    ) {
      throw new Error(
        "❌ Test mode: Configuration file not found. Set EXA_CONFIG_PATH to the ephemeral config.",
      );
    }
    const configService = new ConfigService(configPath);
    const config = configService.get();
    const checksum = configService.getChecksum();

    // Initialize Config DB (dedicated SQLite connection — not journal DB). Keep the handle
    // open for the daemon lifetime so InMemoryConfigStore and the DB watcher can share it;
    // close it on graceful shutdown.
    const configDbPath = ensureConfigDb(config.system.root);
    const configDb = new Database(configDbPath);
    migrateConfigDb(configDb);
    seedConfigDb(configDb);

    // Initialize Database Service first (needed for EventLogger)
    const dbService = new DatabaseService(config);

    // Add EventLoggerStructuredOutput for TUI viewer compatibility
    const logsDir = join(config.system.root, "logs");
    const viewerLogDir = join(logsDir, "event-viewer");
    const viewerOutput = new EventLoggerStructuredOutput(viewerLogDir);

    // Create main EventLogger with database connection and viewer output. Without minLevel,
    // EventLogger defaults to INFO and config's log_level="debug" would silently never apply,
    // filtering debug diagnostics (prompt dumps, raw responses) out of the journal regardless.
    const logger = new EventLogger({
      db: dbService,
      prefix: "",
      defaultActor: DEFAULT_MCP_IDENTITY_ID,
      outputs: [viewerOutput],
      minLevel: config.system.log_level,
    });

    // Initialize GracefulShutdown service
    const gracefulShutdown = new GracefulShutdown(logger);

    // Register signal handlers EARLY so SIGTERM during slow startup (e.g. CI) goes through
    // graceful shutdown (flushes the journal queue) instead of the default immediate-exit
    // handler. Cleanup tasks registered later are no-ops if their services haven't started.
    gracefulShutdown.registerSignalHandlers();
    gracefulShutdown.registerErrorHandlers();

    // Register DB close early so it runs even if SIGTERM arrives during startup.
    // The handler is idempotent — calling close() a second time is a no-op.
    gracefulShutdown.registerCleanup("close_database", async () => {
      dbService.close();
      await logger.info(
        DomainEventType.ShutdownDatabaseClosed,
        "journal.db",
        {},
      );
    });

    // Config DB: populate in-memory store and create adapter
    // Populate InMemoryConfigStore from Config DB + registry defaults, then
    // wire DaemonConfigAdapter into the context.
    const configStore = new InMemoryConfigStore();
    const effectiveValues = getAllEffectiveValues(configDb);
    for (const [key, value] of effectiveValues) {
      const swap = getRegisteredDefaults().get(key)?.opts?.swap ?? SwapClass.HOT;
      configStore.set(key, value, swap);
    }
    // The daemon IS the daemon — construct DaemonConfigAdapter directly rather than through
    // createConfigAdapter's PID-file detection (built for CLI/MCP callers to detect whether a
    // daemon is up); at boot the PID isn't written yet, so detection would wrongly fall back.
    const configAdapter = new DaemonConfigAdapter(configStore, configDb, logger);
    logger.info(DomainEventType.ConfigUpdated, "config_db_store", {
      keys: effectiveValues.size,
      adapterMode: configAdapter.mode,
    });

    // Record one adapter-resolved value and its provenance to verify the boot read path.
    const cutoverProvenance = configAdapter.getProvenance(CONFIG_CUTOVER_PROBE_KEY);
    logger.info(DomainEventType.ConfigCutoverResolved, "config_db", {
      key: CONFIG_CUTOVER_PROBE_KEY,
      value: cutoverProvenance.value,
      source: cutoverProvenance.source,
      adapterMode: configAdapter.mode,
    });

    // Verify Config DB integrity after store initialization and journal the result
    // so operators can detect offline tampering.
    await configAdapter.verifyIntegrity();

    // Keep the Config DB open for the watcher; its separate teardown must not
    // close the database a second time.
    gracefulShutdown.registerCleanup("close_config_db", () => {
      configDb.close();
      return Promise.resolve();
    });

    // Poll for external config overrides and hot-apply eligible keys.
    // The environment override supports shorter integration-test intervals.
    const pollIntervalOverride = Number(Deno.env.get("EXA_CONFIG_DB_POLL_INTERVAL_MS"));
    const configDbPollIntervalMs = Number.isFinite(pollIntervalOverride) && pollIntervalOverride > 0
      ? pollIntervalOverride
      : DEFAULT_CONFIG_DB_POLL_INTERVAL_MS;
    let lastMaxId = getMaxOverrideId(configDb);
    // Schedule integrity verification independently from the faster override poll.
    // Its environment override supports shorter integration-test intervals.
    const integrityPollIntervalOverride = Number(Deno.env.get("EXA_INTEGRITY_POLL_INTERVAL_MS"));
    const integrityPollIntervalMs = Number.isFinite(integrityPollIntervalOverride) &&
        integrityPollIntervalOverride > 0
      ? integrityPollIntervalOverride
      : CONFIG_INTEGRITY_POLL_INTERVAL_MS;
    let lastIntegrityCheckAt = Date.now();
    const pollHandle = setInterval(async () => {
      const currentMaxId = getMaxOverrideId(configDb);
      if (currentMaxId > lastMaxId) {
        await createDbWatcherHandler(configStore, configDb, logger)();
        lastMaxId = currentMaxId;
      }
      // Periodic integrity verify — gated by its own interval so the poll
      // tick rate and the verify rate are decoupled.
      if (Date.now() - lastIntegrityCheckAt >= integrityPollIntervalMs) {
        await configAdapter.verifyIntegrity();
        lastIntegrityCheckAt = Date.now();
      }
    }, configDbPollIntervalMs);

    logger.info(DomainEventType.ConfigDbWatcherStarted, "config_db", {
      pollIntervalMs: configDbPollIntervalMs,
    });

    // Clear pollHandle on graceful shutdown.
    gracefulShutdown.registerCleanup("clear_config_db_poll", () => {
      clearInterval(pollHandle);
      return Promise.resolve();
    });

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

    if (config.system.allow_net === undefined) {
      await logger.info(DomainEventType.NetAllowlist, "default-allowlist", {
        // Read from the constant rather than restated: the literal here kept reporting three hosts
        // after the list grew, so the journal described an allowlist the daemon was not using.
        hosts: DAEMON_DEFAULT_NET_HOSTS.join(","),
      });
    } else if (config.system.allow_net.length === 0) {
      await logger.info(DomainEventType.NetAllowlist, "all-blocked", { hosts: "" });
    } else {
      await logger.info(DomainEventType.NetAllowlist, "custom-allowlist", {
        hosts: config.system.allow_net.join(","),
      });
    }

    // Fail closed when configuration forbids egress but the process has network access.
    const netStatus = await Deno.permissions.query({ name: "net" });
    const netPolicy = evaluateNetPolicy({
      allowNet: config.system.allow_net,
      grantedNet: netStatus.state === "granted",
    });
    if (netPolicy.violated) {
      await logger.error(DomainEventType.NetAllowlist, "policy-violation", {
        reason: netPolicy.reason ?? "net policy violation",
      });
      throw new Error(`Daemon refusing to start: ${netPolicy.reason}`);
    }

    await logger.info(DomainEventType.DatabaseConnected, "journal.db", {
      mode: "WAL",
    });

    // Recovery appends Workspace/Requests, so pass the project root to avoid duplication.
    const recoveryRoot = config.system.root;
    // FlowRunner and orphan recovery share the claim store as launch authority;
    // the cycle store holds atomic resume checkpoints.
    const sessionDelegateCycleClaimStore = new SessionDelegateCycleClaimStore(dbService);
    const sessionDelegateCycleStore = new SessionDelegateCycleStore(
      join(config.system.root, "Memory", "Execution"),
    );
    const recoveredCount = await recoverOrphanedDelegations({
      db: dbService,
      logger,
      workspaceRoot: recoveryRoot,
      briefReader: new SessionBriefReader(join(config.system.root, "Session")),
      claimStore: sessionDelegateCycleClaimStore,
    });
    if (recoveredCount > 0) {
      logger.info(DomainEventType.SessionDelegateCrashRecovered, "crash-recovery", { recovered: recoveredCount });
    }

    // Initialize LLM Provider
    bootstrapProviderRegistry();
    // Edition-aware composer — Team edition additionally registers Team-only
    // capability modules and bootstraps Team-only providers (Vertex AI).
    const editionType = Deno.env.get("EXAIX_EDITION") ?? EDITION_SOLO;
    let _editionComposer: SoloComposer | TeamComposer;
    if (editionType === EDITION_TEAM) {
      const { bootstrapTeamProviders, TeamComposer } = await import("@exaix-team/team-composer");
      bootstrapTeamProviders();
      const teamComposer = new TeamComposer();
      // Register the Team model registry before selection so Team does not
      // fall back to the Solo registry.
      const { registerTeamModelRegistry } = await import("./src/bootstrap_team.ts");
      registerTeamModelRegistry(teamComposer, { db: dbService, config, logger });
      _editionComposer = teamComposer;
    } else {
      _editionComposer = new SoloComposer();
    }
    const defaultModelName = config.agents.default_model;
    const providerInfo = ProviderFactory.getProviderInfoByName(
      config,
      defaultModelName,
    );
    const costTracker = new CostTracker(dbService, config, logger);
    // Pass the logger so provider-level diagnostics (token usage at info, outbound request
    // debug dumps) reach the journal — without it every provider call is a logging black hole.
    const llmProvider = await ProviderFactory.createByName(
      config,
      defaultModelName,
      undefined,
      logger,
      costTracker,
    );

    await logger.info(DomainEventType.LlmProviderInitialized, providerInfo.id, {
      type: providerInfo.type,
      model: providerInfo.model,
      source: providerInfo.source,
      named_model: defaultModelName,
    });

    // Unwrap provider decorators to report mock-fixture drift at shutdown.
    gracefulShutdown.registerCleanup("report_fixture_drift", () => {
      const underlying = unwrapModelProvider(llmProvider);
      if (underlying instanceof MockLLMProvider) {
        const summary = underlying.reportDrift(DEFAULT_FIXTURE_DRIFT_RECAPTURE_THRESHOLD);
        if (summary.driftedCalls > 0) {
          console.warn(
            `[fixture-drift] ${summary.driftedCalls}/${summary.totalCallSiteLookups} call-site lookups ` +
              `drifted this run (rate ${(summary.driftRate * 100).toFixed(0)}%)` +
              `${summary.overThreshold ? " — OVER THRESHOLD, recapture recommended" : ""}. ` +
              `Fixtures: ${summary.fixtures.join(", ")}`,
          );
        }
      }
      return Promise.resolve();
    });

    let guardrailRunner: GuardrailRunner | undefined;
    if (editionType !== EDITION_SOLO && config.guardrail?.enabled) {
      try {
        const { GuardrailRunner } = await import("@exaix-team/guardrail");
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

    let hitlPolicyEvaluator: HitlPolicyEvaluator | undefined;
    if (editionType !== EDITION_SOLO && config.hitl?.enabled) {
      const { HitlPolicyEvaluator } = await import("@exaix-team/hitl");
      hitlPolicyEvaluator = new HitlPolicyEvaluator(
        config.hitl.mandatory_rules,
      );
    }

    // Initialize Git orchestration service
    const gitService = new GitService({
      config,
    });

    const notificationService = new NotificationService(config, dbService);

    // Extraction loads the content policy by explicit skill_id, so the shared skills
    // service must be ready before memory services are composed.
    const skillsService = new SkillsService(
      { memoryDir: join(config.system.root, config.paths.memory), portal: config.paths.workspace },
      dbService,
      undefined,
      logger,
    );
    await skillsService.initialize();

    // Initialize Memory Services (needed for context and request processing)
    const memoryCostRouter = new MemoryCostRouter(costTracker, logger);
    const memoryBank = new MemoryBankService(config, logger, {
      contradictionResolver: new LearningContradictionResolver(llmProvider, memoryCostRouter),
    });
    const memoryAdapter = new MemoryBankAdapter(memoryBank);
    const memoryExtractor = new MemoryExtractorService(
      config,
      dbService,
      memoryAdapter,
      logger,
      {
        costRouter: memoryCostRouter,
        llmStrategy: new LlmLearningExtractor(llmProvider, skillsService, memoryCostRouter),
      },
    );
    const embeddingProvider = createMemoryEmbeddingProvider(config);
    const providerEmbedding = new ProviderEmbeddingService(
      config,
      embeddingProvider,
      memoryCostRouter,
    );

    const tieredEntriesPath = join(
      config.system.root,
      config.paths.memory,
      "tiered_entries.json",
    );
    const sessionMemory = new SessionMemoryService(
      memoryBank,
      providerEmbedding,
      undefined,
      tieredEntriesPath,
    );

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
    // Solo registers TS/JS and Python extractors; Team composition adds
    // extended-language extractors through its hook.
    const symbolRegistry: ISymbolExtractorRegistry = createDefaultSymbolExtractorRegistry();
    const portalKnowledge = new PortalKnowledgeService({
      config: portalKnowledgeConfig,
      memoryBank,
      embeddingProvider,
      createVectorIndex: () => new HnswVectorIndex(),
      symbolExtractorRegistry: symbolRegistry,
      projectsDir: join(config.system.root, config.paths.memory, DEFAULT_PROJECTS_MEMORY_PATH),
    });

    // Create central application context
    const context: IApplicationContext = {
      config: configService,
      configAdapter,
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

    // Initialize health checks for system monitoring
    const _healthService = initializeHealthChecks(dbService, llmProvider, config);

    // Ensure required directories exist
    const requestsPath = join(
      config.system.root,
      config.paths.workspace,
      "Requests",
    );
    const plansPath = join(config.system.root, config.paths.workspace, "Plans");
    const activePath = join(
      config.system.root,
      config.paths.workspace,
      "Active",
    );
    await ensureDir(requestsPath);
    await ensureDir(plansPath);
    await ensureDir(activePath);

    // Review Registry (needed before session-delegation for onReconciled wiring)
    const reviewRegistry = new ReviewRegistry(dbService, logger);

    // Session-delegation runtime
    const LAUNCH_MODE_HEADLESS = "headless";
    const GATE_REFINEMENT = "refinement";
    const GATE_PLAN_REVIEW = "plan_review";
    const GATE_CODE_CHANGES = "code_changes";
    // Allow EXA_SESSION_DELEGATE_ENABLED env var to override TOML config (E2E scenarios)
    if (Deno.env.get("EXA_SESSION_DELEGATE_ENABLED") === "true") {
      const envTool = Deno.env.get("EXA_SESSION_DELEGATE_TOOL");
      const envGatesRaw = Deno.env.get("EXA_SESSION_DELEGATE_GATES");
      const envGates: SessionGate[] = envGatesRaw
        ? envGatesRaw.split(",").map((s) => s.trim()).filter((s): s is SessionGate =>
          s === "refinement" || s === "plan_review" || s === "code_changes" || s === "review"
        )
        : [GATE_REFINEMENT, GATE_PLAN_REVIEW];
      const envHardenRaw = Deno.env.get("EXA_SESSION_DELEGATE_HARDEN_PERMISSIONS");
      const envHarden = envHardenRaw === "true";

      if (!config.session_delegate) {
        config.session_delegate = {
          enabled: true,
          tool: (envTool as SessionTool) ?? "claude-code",
          gates: envGates,
          launch_mode: LAUNCH_MODE_HEADLESS,
          harden_permissions: envHarden,
          bin_overrides: Deno.env.get("EXA_SESSION_DELEGATE_BIN_OVERRIDES")?.split(",").map((s) => s.trim()) ?? [],
        };
      } else {
        config.session_delegate.enabled = true;
        config.session_delegate.gates = envGates;
        config.session_delegate.harden_permissions = envHarden;
        if (envTool) {
          config.session_delegate.tool = envTool as SessionTool;
        }
        const envBins = Deno.env.get("EXA_SESSION_DELEGATE_BIN_OVERRIDES");
        if (envBins) {
          const parsed = envBins.split(",").map((s) => s.trim());
          config.session_delegate.bin_overrides = [
            ...(config.session_delegate.bin_overrides ?? []),
            ...parsed,
          ];
        }
      }
    }
    let sessionReturnWatcher: SessionReturnWatcher | null = null;
    let _headlessLauncher: HeadlessSessionLauncher | null = null;
    let _sessionDelegateService: SessionDelegateService | null = null;
    let _sessionWaitStore: SessionWaitStore | null = null;
    let _sessionResultStore: SessionDelegationResultStore | null = null;
    if (config.session_delegate?.enabled) {
      const sessionDir = join(config.system.root, "Session");
      const workspaceRoot = join(config.system.root, config.paths.workspace);
      const waitStoreBase = join(config.system.root, "Memory", "Execution");
      await ensureDir(sessionDir);
      await ensureDir(waitStoreBase);

      _sessionWaitStore = new SessionWaitStore(waitStoreBase);
      _sessionResultStore = new SessionDelegationResultStore(waitStoreBase);
      const briefReader = new SessionBriefReader(sessionDir);
      _sessionDelegateService = new SessionDelegateService({
        registry: createDefaultSessionAdapterRegistry(),
        sessionDir,
        clock: { now: () => new Date() },
        // Hardened OpenCode launches require PathResolver to generate per-path
        // opencode.jsonc permissions.
        pathResolver: new PathResolver(config),
      });
      const processor = new SessionReturnProcessor({
        sessionDir,
        workspaceRoot,
        waitStore: _sessionWaitStore,
        resultStore: _sessionResultStore,
      });

      const allowlist = new Set([
        SESSION_BIN_CLAUDE_CODE,
        SESSION_BIN_CODEX,
        SESSION_BIN_CURSOR,
        SESSION_BIN_OPENCODE,
        SESSION_BIN_VSCODE,
        ...(config.session_delegate.bin_overrides ?? []),
      ]);

      _headlessLauncher = new HeadlessSessionLauncher({
        sessionDir,
        allowlist,
      });

      const onReconciled = createOnReconciledHandler({
        briefReader,
        workspaceRoot,
        reviewRegistry: {
          getByTrace: (traceId: string) => reviewRegistry.getByTrace(traceId),
          updateStatus: (id: string, status, user, reason) => reviewRegistry.updateStatus(id, status, user, reason),
        },
        costTracker: {
          trackGeneration: (provider, model, usage, traceId) =>
            costTracker.trackGeneration(provider, model, usage, traceId),
        },
        logger,
      });
      sessionReturnWatcher = new SessionReturnWatcher({
        sessionDir,
        processor,
        resultStore: _sessionResultStore,
        logger,
        onReconciled,
      });

      gracefulShutdown.registerCleanup("stop_session_return_watcher", async () => {
        sessionReturnWatcher?.stop();
        await logger.info(DomainEventType.ShutdownWatchersStopped, "session return watcher", {});
      });
    }

    // Initialize wait state storage path for clarification lifecycle
    const waitStatesRoot = join(
      config.system.root,
      config.paths.workspace,
      config.paths.waitStates ?? "WaitStates",
    );

    // The adapter forwards payload.traceId into the logger's explicit trace argument.
    const flowLogger = createFlowEventLogger(logger);

    const healthChecker: IProviderHealthChecker = {
      checkProvider: (_providerName: string) => Promise.resolve(true),
    };
    const routingStrategy = new DefaultRoutingStrategy(ProviderRegistry, costTracker, healthChecker);
    // The composer selects the live Team registry; Solo uses DefaultModelRegistry.
    const modelRegistryProvider = _editionComposer.getModelRegistryProvider();
    const modelRegistry = modelRegistryProvider
      ? modelRegistryProvider.createModelRegistry({
        providerRegistry: ProviderRegistry,
        healthChecker,
      })
      : new DefaultModelRegistry(healthChecker);
    // Late-bind pricing because CostTracker is constructed before the edition registry.
    costTracker.setPricingLookup(modelRegistry);
    // Team supplies live validation and auto-admission through IResolutionStrategy;
    // Solo intentionally supplies no strategy.
    let resolutionStrategy: Opt<IResolutionStrategy, Reason.OptionalDependency>;
    if (editionType === EDITION_TEAM) {
      const bt = await import("./src/bootstrap_team.ts");
      const { buildTeamResolutionStrategy, buildRefreshScheduler, loadBenchmarkFloor } = bt;
      resolutionStrategy = buildTeamResolutionStrategy(modelRegistry, config, logger);
      // Always load the curated benchmark floor; external models.dev ingestion
      // remains gated by registry configuration.
      await loadBenchmarkFloor(modelRegistry, config);
      // The factory returns no scheduler when refresh is disabled; an active
      // scheduler is stopped during graceful shutdown.
      const refreshScheduler = buildRefreshScheduler(modelRegistry, config, logger);
      if (refreshScheduler) {
        refreshScheduler.start();
        gracefulShutdown.registerCleanup("stop_registry_refresh_scheduler", () => {
          refreshScheduler.stop();
          return Promise.resolve();
        });
      }
    }
    const modelResolver = new ModelResolver(
      routingStrategy,
      config,
      healthChecker,
      logger,
      modelRegistry,
      resolutionStrategy,
    );

    // Create FlowRunner for multi-agent flow execution
    const blueprintsPath = join(
      config.system.root,
      config.paths.blueprints,
      DEFAULT_IDENTITIES_PATH,
    );
    // Without this, AgentRunner.matchAndApplySkills short-circuits (skillsService undefined) and a blueprint's default_skills (e.g. response-contract, the <thought>/<content> format contract) are never attached to an analysis-phase LLM call, regardless of the identity's frontmatter. Mirrors apps/exactl/src/init.ts's construction.
    const agentRunner = new AgentRunner(llmProvider, {
      milestoneEmitter: buildMilestoneEmitterFromConfig(config),
      skillsService,
      logger,
      // Disabling prompt injection also disables skill matching and its journal events.
      disableSkills: !config.skills.inject_in_prompt,
    });
    const portalPermissions = new PortalPermissionsService(config.portals ?? []);
    // Team composition provides dynamic-step dispatch; initialization failure
    // degrades to execution without dynamic steps.
    let mcpClient: LocalToolDispatcher | undefined;
    if (editionType === EDITION_TEAM) {
      mcpClient = await buildTeamMcpClient(context, portalPermissions, logger);
    }
    const agentExecutorAdapter = new AgentOrchestratorAdapter(
      agentRunner,
      blueprintsPath,
      {
        config,
        db: dbService,
        logger,
        permissions: portalPermissions,
        provider: llmProvider,
        modelResolver,
      },
    );
    // FlowRunner and PlanExecutor share one coordinator as delegation authority.
    const sessionDelegationCoordinator = _sessionDelegateService && _sessionWaitStore && _sessionResultStore &&
        _headlessLauncher && config.session_delegate?.gates?.includes(GATE_CODE_CHANGES)
      ? new SessionDelegationCoordinator({
        config: config.session_delegate,
        delegateService: _sessionDelegateService,
        waitStore: _sessionWaitStore,
        resultStore: _sessionResultStore,
        launcher: _headlessLauncher,
        resolveModel: (traceId: string) =>
          resolveModelFromTrace(
            traceId,
            join(config.system.root, "Workspace", DEFAULT_REQUESTS_PATH),
            modelResolver,
          ),
        resolveProviderApiKey: (keyEnv: string) => Deno.env.get(keyEnv),
        now: () => new Date(),
        sleep: (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      }, logger)
      : undefined;
    const gateEvaluator = new GateEvaluator(createJudgeEvaluator(new JudgeAgentRunner(llmProvider)));
    const flowRunner = new FlowRunner({
      agentExecutor: agentExecutorAdapter,
      gateEvaluator,
      config,
      eventLogger: flowLogger,
      hitlPolicyEvaluator,
      modelResolver,
      dynamicModeTools: DYNAMIC_MODE_TOOLS,
      dynamicModeApprovalTools: DYNAMIC_MODE_APPROVAL_TOOLS,
      mcpClient,
      flowTraceStore: new FlowTraceStore(join(config.system.root, "Memory", "Execution", "flow_traces")),
      sessionDelegationCoordinator,
      planContextResolver: sessionDelegationCoordinator ? new PlanContextResolver() : undefined,
      sessionDelegateCycleClaimStore,
      sessionDelegateCycleStore,
    });

    // The processor needs the flow itself, not a verdict about it: it previously cast `{ id } as IFlow` and FlowRunner crashed reading `steps.length` on the result.  Read `config.paths.flows` rather than recomposing it from `paths.blueprints` and `DEFAULT_FLOWS_PATH`. The two agree on a default workspace and diverge the moment an operator overrides the setting — which would leave `exactl flow list` honouring the override while the daemon that actually runs the flows ignored it.
    const flowLoader = new FlowLoaderAdapter(
      new FlowLoader(join(config.system.root, config.paths.flows)),
    );

    // Wire Team-edition capability modules through the edition-composer seam.
    // Dynamic import keeps bootstrap_team.ts (+ its @exaix-team deps) out of the Solo binary.
    if (editionType === EDITION_TEAM) {
      const { registerTeamCapabilities } = await import("./src/bootstrap_team.ts");
      registerTeamCapabilities(
        agentExecutorAdapter,
        logger,
        flowRunner,
        _editionComposer as TeamComposer,
        symbolRegistry,
        hitlPolicyEvaluator,
      );
    }

    // Initialize Request Processor
    const requestProcessor = new RequestProcessor({
      workspacePath: join(config.system.root, config.paths.workspace),
      requestsDir: requestsPath,
      blueprintsPath: join(
        config.system.root,
        config.paths.blueprints,
        DEFAULT_IDENTITIES_PATH,
      ),
      includeReasoning: true,
      context, // Support unified DI
      agentRunner,
      // Share the tracker already bound to edition-specific registry pricing.
      costTracker,
      sessionMemory,
      flowRunner,
      flowLoader,
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
      onDelegateRefinement: _sessionDelegateService && _sessionWaitStore
        ? async (traceId: string, _requestId: string, body: string) => {
          const sd = config.session_delegate!;
          const requestPath = join(config.system.root, "Workspace", DEFAULT_REQUESTS_PATH, `${_requestId}.md`);
          const resolvedModel = await resolveRequestModel(requestPath, modelResolver);
          // Use optional chaining for obj access instead of type-assertion cast
          const brief = await _sessionDelegateService!.prepareBrief({
            traceId,
            identityId: DAEMON_IDENTITY_ID,
            gate: GATE_REFINEMENT,
            tool: sd.tool,
            objective: body,
            ...(resolvedModel && { model: resolvedModel }),
            artifactRef: `Workspace/Requests/${_requestId}.md`,
            permittedPaths: [`Workspace/Requests/${_requestId}.md`],
            tokenBudget: sd.token_budget ??
              { max_input_tokens: 10000, max_output_tokens: 10000, max_total_tokens: 20000 },
            deadline: new Date(Date.now() + 3_600_000).toISOString(),
          });
          const state = await _sessionWaitStore!.park(traceId, brief.gate, brief.resume_token, brief.deadline);
          if (state.status !== "pending") throw new Error("failed to park refinement wait state");

          if (sd.launch_mode === LAUNCH_MODE_HEADLESS && _headlessLauncher) {
            let launch: ISessionLaunch;
            if (sd.harden_permissions) {
              const hardened = await _sessionDelegateService!.resolveHardenedLaunch(
                brief,
                LAUNCH_MODE_HEADLESS,
                sd,
              );
              if (hardened.agentNameMismatch) {
                await logger.info(DomainEventType.SessionDelegateAgentMismatch, traceId, {
                  tool: sd.tool,
                });
              }
              if (hardened.versionWarning) {
                await logger.warn(DomainEventType.SessionDelegateVersionWarning, traceId, {
                  warning: hardened.versionWarning,
                  tool: sd.tool,
                });
              }
              launch = hardened.launch;
            } else {
              launch = _sessionDelegateService!.resolveLaunch(brief, LAUNCH_MODE_HEADLESS);
            }
            let delegateProviderEnv: Record<string, string> | undefined;
            if (sd.provider) {
              const apiKey = Deno.env.get(sd.provider.key_env);
              if (!apiKey && sd.provider.name !== ProviderType.OLLAMA) {
                throw new Error(
                  `[session_delegate] provider '${sd.provider.name}' requires env '${sd.provider.key_env}' — not set`,
                );
              }
              if (apiKey) {
                delegateProviderEnv = _sessionDelegateService!.resolveDelegateEnv(sd, sd.tool, apiKey);
              }
            }
            // Emit before spawning; the explicit trace argument persists trace_id for
            // orphan recovery and trace-scoped queries.
            await logger.info(DomainEventType.SessionDelegateLaunched, traceId, {
              gate: GATE_REFINEMENT,
              tool: sd.tool,
              brief: brief.objective,
            }, traceId);
            await _headlessLauncher.launch(launch, traceId, delegateProviderEnv);
          } else {
            logger.info(DomainEventType.SessionDelegateBriefed, traceId, {
              mode: sd.launch_mode,
              tool: sd.tool,
              objective_length: body.length,
            }, traceId);
          }
        }
        : undefined,
    });

    await logger.info(
      DomainEventType.DaemonRequestProcessorInitialized,
      "RequestProcessor",
      {
        requestsDir: requestsPath,
        blueprints: join(
          config.system.root,
          config.paths.blueprints,
          DEFAULT_IDENTITIES_PATH,
        ),
      },
    );

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
    }, { db: dbService });

    const onCodeChangesDelegate = sessionDelegationCoordinator
      ? createCodeChangesDelegateAdapter({
        coordinator: sessionDelegationCoordinator,
        logger,
      })
      : undefined;

    const gitServiceFactory = {
      createGitService(repoPath: string, traceId: string) {
        return new GitService({ config, traceId, identityId: DAEMON_IDENTITY_ID, repoPath, context });
      },
    };

    const amendmentService = new PlanAmendmentService(config, llmProvider);
    const amendmentGate = new PlanAmendmentGate(config, amendmentService, undefined, logger);

    const executionLoop = new ExecutionLoop({
      context,
      config,
      db: dbService,
      identityId: DAEMON_IDENTITY_ID,
      llmProvider,
      amendmentService,
      amendmentGate,
      reviewRegistry,
      sessionMemory,
      guardrailRunner,
      hitlPolicyEvaluator,
      memoryBank,
      onCodeChangesDelegate,
      gitServiceFactory,
      toolRegistryFactory: {
        createToolRegistry(traceId: string, baseDir: string) {
          return new ToolRegistry({
            config,
            traceId,
            identityId: DAEMON_IDENTITY_ID,
            baseDir,
            context,
            hitlPolicyEvaluator,
            gitServiceFactory,
          });
        },
      },
      // Share the daemon logger so execution and model-routing events reach the journal.
      logger,
      // Share the configured resolver so plan execution uses the same routing policy.
      modelResolver,
      // Share the edition registry so prompt budgeting uses resolved context windows.
      modelRegistry,
    });

    // Initialize Memory Auto-Approval Service (reuses memoryExtractor from context setup)
    const autoApprovalService = new MemoryAutoApprovalService(
      config,
      memoryExtractor,
    );

    // Reflection loads the content policy by explicit skill_id and consolidates the
    // approved store (synthesise via Memory/Pending proposals, deterministic merge, prune).
    const reflectionService = new MemoryReflectionService({
      provider: llmProvider,
      skillsService,
      memoryBank,
      embeddingService: providerEmbedding,
      proposalWriter: memoryExtractor,
      logger,
      costRouter: memoryCostRouter,
    });

    const { stop: stopAutoApproval } = await initializeMemoryAutoApprovalMaintenance({
      notificationService,
      memoryExtractor,
      autoApprovalService,
      logger,
      intervalMs: 60 * 60 * 1000,
      sessionMemory,
      memoryBank,
      reflectionService,
    });

    // Start file watcher for approved plans (Workspace/Active)
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
      { customWatchPath: activePath, db: dbService }, // Custom watch path
    );

    // Dynamic Config Reloading (Task: Investigate missing portal logs)
    // Watch for changes to  to reload config and log changes
    const configWatcher = new FileWatcher(
      config,
      createConfigReloadHandler(configService, logger),
      {
        customWatchPath: config.system.root,
        extensions: [".toml"],
        db: dbService,
      },
    );

    // Register cleanup tasks for graceful shutdown
    gracefulShutdown.registerCleanup("stop_request_watcher", async () => {
      await requestWatcher.stop();
      await logger.info(
        DomainEventType.ShutdownWatchersStopped,
        "request and plan watchers",
        {},
      );
    });

    gracefulShutdown.registerCleanup("stop_plan_watcher", async () => {
      await planWatcher.stop();
    });

    gracefulShutdown.registerCleanup("stop_config_watcher", async () => {
      await configWatcher.stop();
    });

    gracefulShutdown.registerCleanup("stop_auto_approval", async () => {
      stopAutoApproval();
      await logger.info(
        DomainEventType.ShutdownAutoApprovalStopped,
        "memory auto-approval cycle",
        {},
      );
    });

    // Establish all watchers (start() returns once each FS watch is open and watcher.started is journalled — it does NOT block on the consume-loop). Awaiting these confirms every watcher is genuinely listening before we emit daemon.started, so that event is a true "fully functioning" readiness signal with no race window for a consumer that waits on it.
    const fileWatchers = [requestWatcher, planWatcher, configWatcher];
    await Promise.all(fileWatchers.map((w) => w.start()));

    // SessionReturnWatcher.start() is a blocking consume-loop (its own design), so launch it
    // detached and keep its promise for the long-lived await below — never await it for readiness.
    const longLived = fileWatchers.map((w) => w.run());
    if (sessionReturnWatcher) longLived.push(sessionReturnWatcher.start());

    // daemon.ready (NOT daemon.started): the watchers above are confirmed listening, so this is the authoritative "fully functioning" signal. The CLI `daemon start` already emitted daemon.started on process-alive; emitting a distinct daemon.ready here avoids two same-named events and lets a consumer wait for genuine readiness (the request watcher is live) before submitting work.
    await logger.log({
      action: DomainEventType.DaemonReady,
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

    // Keep the daemon alive on the detached consume-loops (this is the long-lived main loop;
    // each resolves only when its watcher stops during graceful shutdown).
    await Promise.all(longLived);
  } catch (error) {
    console.error("❌ Fatal Error:", error);
    Deno.exit(1);
  }
}
