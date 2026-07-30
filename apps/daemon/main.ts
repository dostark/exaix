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
  EDITION_SOLO,
  EDITION_TEAM,
  ProviderType,
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
import { buildDelegateBriefArgs, isContentlessBrief } from "@exaix/core/planning";
import { FileWatcher } from "../../apps/daemon/src/watcher.ts";
import { DatabaseService } from "@exaix/storage-sqlite";
import {
  DefaultRoutingStrategy,
  type IProviderHealthChecker,
  type IResolutionStrategy,
  ModelResolver,
  ProviderFactory,
  ProviderRegistry,
} from "@exaix/ai";
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
  FlowLoader,
  FlowRunner,
  type IFlowEventLogger,
  type IFlowEventPayload,
} from "@exaix/flow";
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
import { SkillsService } from "@exaix/core/skills";
import { FlowLoaderAdapter } from "../../apps/common/adapters/flow_loader_adapter.ts";
import { MemoryBankAdapter } from "../../apps/common/adapters/memory_bank_adapter.ts";
import {
  createDefaultSymbolExtractorRegistry,
  type ISymbolExtractorRegistry,
  PortalKnowledgeService,
} from "@exaix/portal/knowledge";
import { PathResolver } from "@exaix/portal";
import type { IPortalKnowledgeConfig, PortalAnalysisMode } from "@exaix/core/types";
import { createConfigReloadHandler, createDbWatcherHandler, getMaxOverrideId } from "@exaix/core/config";
import { GracefulShutdown } from "./src/graceful_shutdown.ts";
import { recoverOrphanedDelegations } from "./src/recovery.ts";
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
import { SessionWaitStore } from "@exaix/session/wait/session_wait_store.ts";
import { SessionReturnProcessor } from "@exaix/session/session_return_processor.ts";
import { SessionReturnWatcher } from "./src/session_return_watcher.ts";
import { HeadlessSessionLauncher } from "./src/headless_session_launcher.ts";
import { createOnReconciledHandler } from "./src/on_reconciled_dispatcher.ts";
import { SessionDelegateService } from "@exaix/session/session_delegate_service.ts";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import type { SessionGate, SessionTool } from "@exaix/schemas/session_delegate.ts";
import type { ISessionLaunch } from "@exaix/session/i_session_adapter.ts";
import {
  CONFIG_INTEGRITY_POLL_INTERVAL_MS,
  DEFAULT_CONFIG_DB_POLL_INTERVAL_MS,
  DEFAULT_REQUESTS_PATH,
  SESSION_BIN_CLAUDE_CODE,
  SESSION_BIN_CURSOR,
  SESSION_BIN_OPENCODE,
  SESSION_BIN_VSCODE,
} from "@exaix/core/types/constants.ts";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";
import { SoloComposer } from "@exaix/core/composer";
// Team modules are loaded dynamically ONLY inside the editionType !== "solo" branches
// below, so the Solo binary never references @exaix-team/* at all (a static top-level
// dependency would be bundled by `deno compile` even in Solo — defeating edition
// separation). Type-only imports are erased at compile time and are safe to keep static.
import type { TeamComposer } from "@exaix-team/team-composer";
import type { GuardrailRunner } from "@exaix-team/guardrail";
import type { HitlPolicyEvaluator } from "@exaix-team/hitl";

/** LRU cache for traceId → resolved model string (PG-6 remediation). */
const traceModelCache = new Map<string, string>();
const TRACE_CACHE_MAX = 100;

/**
 * Representative migrated config key the daemon resolves through `configAdapter` at boot
 * (Phase 137 Step 11 / GAP-17). Its journalled provenance proves the cutover read path is
 * live end-to-end. `ai.timeout_ms` is registered via `configurable()` in Step 10.
 */
const CONFIG_CUTOVER_PROBE_KEY = "ai.timeout_ms";

/**
 * Read a request file, parse its frontmatter, build a IModelIntent from any CLI
 * flags present (model_size, thinking, effort, etc.), and resolve through
 * ModelResolver. Returns "provider:model" string or undefined if the request
 * has no IModelIntent fields or the file cannot be read.
 */
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

/**
 * Find a request file by traceId and resolve its model.
 * Uses an in-memory LRU cache to avoid repeated filesystem scans (PG-6).
 */
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

    // Initialize Config DB (dedicated SQLite connection — not journal DB).
    // Phase 137 Step 3: keep the handle open for the daemon lifetime so the
    // InMemoryConfigStore and DB watcher can share it. Close on graceful shutdown.
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
    // EventLogger defaults to INFO and config's log_level = "debug" silently never applies —
    // debug-level diagnostics (prompt dumps, raw LLM responses, provider request bodies)
    // would be filtered out of the journal no matter what the config says.
    const logger = new EventLogger({
      db: dbService,
      prefix: "",
      defaultActor: DEFAULT_MCP_IDENTITY_ID,
      outputs: [viewerOutput],
      minLevel: config.system.log_level,
    });

    // Initialize GracefulShutdown service
    const gracefulShutdown = new GracefulShutdown(logger);

    // Register signal handlers EARLY so SIGTERM during slow startup (e.g. CI)
    // goes through graceful shutdown (which flushes the journal queue) instead of
    // the default handler (immediate exit, queue lost). Cleanup tasks registered
    // later (watchers, auto-approval) are no-ops if their services haven't started.
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

    // ── Config DB: populate in-memory store and create adapter ────────────
    // Phase 137 Step 3: populate InMemoryConfigStore from Config DB +
    // registry defaults, then wire DaemonConfigAdapter into the context.
    const configStore = new InMemoryConfigStore();
    const effectiveValues = getAllEffectiveValues(configDb);
    for (const [key, value] of effectiveValues) {
      const swap = getRegisteredDefaults().get(key)?.opts?.swap ?? SwapClass.HOT;
      configStore.set(key, value, swap);
    }
    // The daemon IS the daemon — construct DaemonConfigAdapter directly rather than
    // going through createConfigAdapter's PID-file detection (that factory is for
    // CLI/MCP callers detecting whether a daemon is up; at boot the daemon has not
    // written its PID yet, so detection would wrongly fall back to DirectConfigAdapter).
    const configAdapter = new DaemonConfigAdapter(configStore, configDb, logger);
    logger.info(DomainEventType.ConfigUpdated, "config_db_store", {
      keys: effectiveValues.size,
      adapterMode: configAdapter.mode,
    });

    // Phase 137 Step 11 (GAP-17): prove the cutover is live — resolve a representative
    // migrated key through the adapter (Config DB → registry → schema) and journal the
    // result with its provenance. This is the daemon's first production read through
    // `configAdapter`; the value + source are observable in the journal so the cutover is
    // verifiable end-to-end (tests/integration/config_cutover_daemon_boot_test.ts).
    const cutoverProvenance = configAdapter.getProvenance(CONFIG_CUTOVER_PROBE_KEY);
    logger.info(DomainEventType.ConfigCutoverResolved, "config_db", {
      key: CONFIG_CUTOVER_PROBE_KEY,
      value: cutoverProvenance.value,
      source: cutoverProvenance.source,
      adapterMode: configAdapter.mode,
    });

    // Phase 139 Step 7: verify config integrity at boot — journal the result so
    // an operator can see whether the Config DB was tampered with while the daemon
    // was down. This runs after the store is populated and the adapter is wired.
    await configAdapter.verifyIntegrity();

    // Register configDb.close() on graceful shutdown (kept open for the
    // watcher's lifetime). The DB-watcher's own teardown (Step 4) will be
    // registered separately and must not double-close.
    gracefulShutdown.registerCleanup("close_config_db", () => {
      configDb.close();
      return Promise.resolve();
    });

    // ── Config DB polling watcher ────────────────────────────────────────
    // Phase 137 Step 4: poll for new MAX(id) in config_overrides and
    // hot-apply swap:hot keys detected from external CLI writes. The interval
    // defaults to DEFAULT_CONFIG_DB_POLL_INTERVAL_MS; EXA_CONFIG_DB_POLL_INTERVAL_MS
    // overrides it so integration tests can drive the watcher within a short boot.
    const pollIntervalOverride = Number(Deno.env.get("EXA_CONFIG_DB_POLL_INTERVAL_MS"));
    const configDbPollIntervalMs = Number.isFinite(pollIntervalOverride) && pollIntervalOverride > 0
      ? pollIntervalOverride
      : DEFAULT_CONFIG_DB_POLL_INTERVAL_MS;
    let lastMaxId = getMaxOverrideId(configDb);
    // Phase 139 Step 7: gate periodic integrity verify so independent of the
    // shorter DB-watcher poll interval. Env override allows integration tests
    // to drive the check within a test-length boot.
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

    // Phase 121 Step 2: log the effective net allowlist
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

    // Phase 124 (full-alignment): self-enforce the allow_net policy regardless of
    // how the daemon was launched. The launcher bakes --allow-net into the spawn,
    // but a compiled binary or `deno task dev` freezes its flags at build time and
    // cannot honour allow_net. If the config says "block all outbound" (allow_net=[])
    // yet this process still holds net access, refuse to start (fail-closed) — the
    // operator asked for no egress and we must not silently provide it.
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

    // Phase 121 Step 3: recover orphaned session delegations from journal.
    // recovery.ts joins workspaceRoot + "Workspace" + "Requests", so pass the
    // project root (config.system.root) here — NOT root/workspace, which would
    // produce a doubled Workspace/Workspace/Requests path the watcher never scans
    // (Phase 124 GAP-9, caught by the Step 4b E2E).
    const recoveryRoot = config.system.root;
    const recoveredCount = await recoverOrphanedDelegations({
      db: dbService,
      logger,
      workspaceRoot: recoveryRoot,
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
      // Phase 135 Step 1 (GAP-2): register the live model-registry provider BEFORE
      // the registry is selected below (getModelRegistryProvider()), so a Team
      // daemon resolves through ModelRegistryService rather than the Solo floor.
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
    const costTracker = new CostTracker(dbService, config);
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

    // Construct GuardrailRunner if enabled and Team edition (Phase 107)
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

    // Phase 118: Initialize HITL policy evaluator if Team edition and enabled
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

    // Initialize Memory Services (needed for context and request processing)
    const memoryBank = new MemoryBankService(config, logger);
    const memoryAdapter = new MemoryBankAdapter(memoryBank);
    const memoryExtractor = new MemoryExtractorService(
      config,
      dbService,
      memoryAdapter,
    );
    const embCfg = config.memory?.embedding;
    const providerType = embCfg?.provider ?? "ollama";
    let providerConfig: IEmbeddingProviderConfig;
    switch (providerType) {
      case ProviderType.OPENAI:
        providerConfig = {
          provider: ProviderType.OPENAI,
          apiKey: embCfg?.apiKey ?? "",
          model: embCfg?.model,
        };
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
    const memoryCostRouter = new MemoryCostRouter(costTracker, logger);
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
    // Build per-language symbol-extractor registry (Phase 119 Step 4):
    // Solo baseline includes TS/JS + Python tree-sitter; Team edition adds
    // extended-language extractors via the composer hook (below, at :347).
    const symbolRegistry: ISymbolExtractorRegistry = createDefaultSymbolExtractorRegistry();
    const portalKnowledge = new PortalKnowledgeService({
      config: portalKnowledgeConfig,
      memoryBank,
      embeddingProvider,
      createVectorIndex: () => new HnswVectorIndex(),
      symbolExtractorRegistry: symbolRegistry,
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

    // ── Review Registry (needed before session-delegation for onReconciled wiring) ──
    const reviewRegistry = new ReviewRegistry(dbService, logger);

    // ── Session-delegation runtime (Phase 111) ──────────────────────────
    const LAUNCH_MODE_HEADLESS = "headless";
    const DECISION_ABANDONED = "abandoned";
    const DECISION_CHANGES_MADE = "changes_made";
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
    if (config.session_delegate?.enabled) {
      const sessionDir = join(config.system.root, "Session");
      const workspaceRoot = join(config.system.root, config.paths.workspace);
      const waitStoreBase = join(config.system.root, "Memory", "Execution");
      await ensureDir(sessionDir);
      await ensureDir(waitStoreBase);

      _sessionWaitStore = new SessionWaitStore(waitStoreBase);
      _sessionDelegateService = new SessionDelegateService({
        registry: createDefaultSessionAdapterRegistry(),
        sessionDir,
        clock: { now: () => new Date() },
        // pathResolver is REQUIRED for the OpenCode hardening path (resolveHardenedLaunch generates
        // the per-path opencode.jsonc permission config). Without it, harden_permissions=true +
        // tool=opencode throws at launch — the Phase 128 feature was unreachable in production.
        pathResolver: new PathResolver(config),
      });
      const processor = new SessionReturnProcessor({
        sessionDir,
        workspaceRoot,
        waitStore: _sessionWaitStore,
      });

      const allowlist = new Set([
        SESSION_BIN_CLAUDE_CODE,
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
        sessionDir,
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

    // Create flow event logger adapter (EventLogger → IFlowEventLogger)
    const flowLogger: IFlowEventLogger = {
      log: <TEvent extends string>(
        event: TEvent,
        payload: IFlowEventPayload<TEvent>,
      ): void => {
        logger.info(
          event,
          "flow-runner",
          payload as Record<
            string,
            string | number | boolean | null | undefined
          >,
        );
      },
    };

    // Phase 132.4: Create ModelResolver for policy-driven model routing
    const healthChecker: IProviderHealthChecker = {
      checkProvider: (_providerName: string) => Promise.resolve(true),
    };
    const routingStrategy = new DefaultRoutingStrategy(ProviderRegistry, costTracker, healthChecker);
    // Phase 134 D8: Select model registry via edition-composer seam.
    // Solo -> DefaultModelRegistry; Team -> live registry via registered provider.
    const modelRegistryProvider = _editionComposer.getModelRegistryProvider();
    const modelRegistry = modelRegistryProvider
      ? modelRegistryProvider.createModelRegistry({
        providerRegistry: ProviderRegistry,
        healthChecker,
      })
      : new DefaultModelRegistry(healthChecker);
    // Phase 135 Step 2 (GAP-4, D9): late-bind the edition-selected registry as the
    // CostTracker's pricing lookup — the tracker was constructed earlier (line ~517),
    // before the registry existed. IModelRegistry satisfies IModelPricingLookup
    // (getModelPricing). Edition-agnostic: floor in Solo, live service in Team.
    costTracker.setPricingLookup(modelRegistry);
    // Phase 135 Step 3 (GAP-1 consumer): in Team edition, wire the live registry's
    // explicit-validation / auto-admit behaviour into the resolver via the
    // IResolutionStrategy seam. Solo passes no strategy → byte-identical 134 behaviour.
    let resolutionStrategy: Opt<IResolutionStrategy, Reason.OptionalDependency>;
    if (editionType === EDITION_TEAM) {
      const bt = await import("./src/bootstrap_team.ts");
      const { buildTeamResolutionStrategy, buildRefreshScheduler, loadBenchmarkFloor } = bt;
      resolutionStrategy = buildTeamResolutionStrategy(modelRegistry, config, logger);
      // Phase 135 Step 7: populate the benchmark data plane. Curated floor loads
      // unconditionally; models.dev ingest runs only behind the double gate. Feeds top-N
      // admission (G6) and the Step 8 `best` scorer.
      await loadBenchmarkFloor(modelRegistry, config);
      // Phase 135 Step 5: opt-in registry refresh scheduler. buildRefreshScheduler
      // returns undefined unless model_registry.enabled === true, so a disabled Team
      // daemon makes zero outbound calls. start() honours refresh_on_start; the single
      // timer is skipped under DENO_TEST=1 and cleared on graceful shutdown.
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
    // Without this, AgentRunner.matchAndApplySkills short-circuits (skillsService undefined) and
    // a blueprint's default_skills (e.g. response-contract, the <thought>/<content> format
    // contract) are never attached to an analysis-phase LLM call, regardless of the identity's
    // frontmatter. Mirrors apps/exactl/src/init.ts's construction.
    const skillsService = new SkillsService(
      { memoryDir: join(config.system.root, config.paths.memory), portal: config.paths.workspace },
      dbService,
      undefined,
      // Without a logger every skills event (match_completed, skill.used, skill.created)
      // is silently dropped — `this.logger?.` short-circuits — so skill selection left no
      // trace in the Activity Journal at all.
      logger,
    );
    await skillsService.initialize();
    const agentRunner = new AgentRunner(llmProvider, {
      milestoneEmitter: buildMilestoneEmitterFromConfig(config),
      skillsService,
      logger,
    });
    const agentExecutorAdapter = new AgentOrchestratorAdapter(
      agentRunner,
      blueprintsPath,
    );
    const flowRunner = new FlowRunner({
      agentExecutor: agentExecutorAdapter,
      config,
      eventLogger: flowLogger,
      hitlPolicyEvaluator,
      modelResolver,
      dynamicModeTools: DYNAMIC_MODE_TOOLS,
      dynamicModeApprovalTools: DYNAMIC_MODE_APPROVAL_TOOLS,
    });

    // The processor needs the flow itself, not a verdict about it: it previously cast
    // `{ id } as IFlow` and FlowRunner crashed reading `steps.length` on the result.
    //
    // Read `config.paths.flows` rather than recomposing it from `paths.blueprints` and
    // `DEFAULT_FLOWS_PATH`. The two agree on a default workspace and diverge the moment an
    // operator overrides the setting — which would leave `exactl flow list` honouring the
    // override while the daemon that actually runs the flows ignored it.
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
      // Phase 135 Step 9 (GAP-C9): share the daemon's own tracker (pricing lookup
      // already set at line ~765) — a self-constructed tracker would never split-price
      // (registry_computed permanently unreachable for standard-request generations).
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
            // Phase 124 Step 4a: emit launched before spawning (orphan marker on crash).
            await logger.info(DomainEventType.SessionDelegateLaunched, traceId, {
              gate: GATE_REFINEMENT,
              tool: sd.tool,
              brief: brief.objective,
            });
            await _headlessLauncher.launch(launch, traceId, delegateProviderEnv);
          } else {
            logger.info(DomainEventType.SessionDelegateBriefed, traceId, {
              mode: sd.launch_mode,
              tool: sd.tool,
              objective_length: body.length,
            });
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

    const onCodeChangesDelegate = _sessionDelegateService && _sessionWaitStore && _headlessLauncher &&
        config.session_delegate?.gates?.includes(GATE_CODE_CHANGES)
      ? async (
        traceId: string,
        step: { number: number; title: string; content: string; successCriteria?: string[] },
        worktreePath: string,
      ): Promise<string> => {
        const sd = config.session_delegate!;
        const requestsDir = join(config.system.root, "Workspace", DEFAULT_REQUESTS_PATH);
        const resolvedModel = await resolveModelFromTrace(traceId, requestsDir, modelResolver);
        if (isContentlessBrief(step.content)) {
          await logger.warn(DomainEventType.SessionDelegateContentlessBrief, traceId, {
            trace_id: traceId,
            step_id: String(step.number),
            objective_preview: step.content.slice(0, 80),
          });
          return DECISION_ABANDONED;
        }
        try {
          const briefArgs = buildDelegateBriefArgs(step);
          const brief = await _sessionDelegateService!.prepareBrief({
            traceId,
            gate: GATE_CODE_CHANGES,
            tool: sd.tool,
            ...(resolvedModel ? { model: resolvedModel } : sd.model ? { model: sd.model } : {}),
            objective: briefArgs.objective,
            ...(briefArgs.acceptanceCriteria ? { acceptanceCriteria: briefArgs.acceptanceCriteria } : {}),
            artifactRef: `trace:${traceId}/step:${step.number}`,
            // `paths_touched` are worktree-relative, so a portal code change reports
            // `src/main.ts` — the previous hardcoded `Workspace/**` matched none of it
            // and reconcile rejected every live return as a scope violation. Presets
            // declare the tree their tasks may edit; the fallback preserves the prior
            // behaviour for configs that have not opted in.
            permittedPaths: sd.permitted_paths ?? [`Workspace/**`],
            // Use the REAL worktree the execution loop created (PlanExecutor's executionRoot),
            // not a recomputed path — fixes the LIVE-RT "No such cwd" spawn failure (Layer 12).
            worktreePath,
            tokenBudget: sd.token_budget ??
              { max_input_tokens: 50000, max_output_tokens: 50000, max_total_tokens: 100000 },
            deadline: new Date(Date.now() + 3_600_000).toISOString(),
          });
          const state = await _sessionWaitStore!.park(traceId, brief.gate, brief.resume_token, brief.deadline);
          if (state.status !== "pending") {
            logger.info(DomainEventType.SessionDelegateReconciled, traceId, {
              gate: GATE_CODE_CHANGES,
              error: `failed to park wait state (${state.status})`,
            });
            return DECISION_ABANDONED;
          }

          if (sd.launch_mode === LAUNCH_MODE_HEADLESS) {
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
            // Phase 124 Step 4a: emit the launched event BEFORE spawning so a
            // crash during launch leaves a `launched` with no terminal event —
            // the orphan that recoverOrphanedDelegations re-queues on restart.
            await logger.info(DomainEventType.SessionDelegateLaunched, traceId, {
              gate: GATE_CODE_CHANGES,
              tool: sd.tool,
              brief: brief.objective,
            });
            await _headlessLauncher.launch(launch, traceId, delegateProviderEnv);
          }
          // `briefed` records that a brief was prepared and parked — true on every
          // launch mode. It was previously emitted only on the non-headless branch,
          // so a headless run (the dogfood path) journalled `launched` with no
          // `briefed`, leaving the audit chain incomplete and making any assertion
          // on the event unsatisfiable (Phase 150 LIVE-RT, GAP-D).
          // Awaited, like the `launched` emission above: an un-awaited write races
          // daemon shutdown and is simply lost, which is how the old non-headless
          // emission could go missing too.
          await logger.info(DomainEventType.SessionDelegateBriefed, traceId, {
            mode: sd.launch_mode,
            tool: sd.tool,
            gate: GATE_CODE_CHANGES,
          });

          // Block until reconciled or deadline — poll every 2s
          const deadline = Date.parse(brief.deadline);
          while (Date.now() < deadline) {
            const current = await _sessionWaitStore!.get(traceId);
            if (current && current.status === "resumed") {
              return current.decision === DECISION_CHANGES_MADE ? DECISION_CHANGES_MADE : DECISION_ABANDONED;
            }
            if (current && (current.status === "expired" || current.status === "cancelled")) {
              return DECISION_ABANDONED;
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
          return DECISION_ABANDONED;
        } catch (err) {
          // Brief preparation or launch failed — journal a distinct failure event (not reconciled)
          logger.info(DomainEventType.SessionDelegateBriefFailed, traceId, {
            gate: GATE_CODE_CHANGES,
            step_id: String(step.number),
            error: err instanceof Error ? err.message : String(err),
          });
          try {
            await _sessionWaitStore!.expire(traceId);
          } catch { /* ignore */ }
          return DECISION_ABANDONED;
        }
      }
      : undefined;

    const gitServiceFactory = {
      createGitService(repoPath: string, traceId: string) {
        return new GitService({ config, traceId, identityId: DAEMON_IDENTITY_ID, repoPath, context });
      },
    };

    const executionLoop = new ExecutionLoop({
      context,
      config,
      db: dbService,
      identityId: DAEMON_IDENTITY_ID,
      llmProvider,
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
      // Phase 135 Step 9 (GAP-C9): without a logger, ExecutionLoop.logActivity no-ops and
      // the same unset logger passes through to PlanExecutor — silencing every plan-
      // execution event (including model.resolved/model.route.selected/model.admitted
      // emitted deeper in AgentOrchestrator/ModelResolver) from the Activity Journal.
      logger,
      // Phase 135 Step 9 (GAP-C9): threaded to PlanExecutor -> AgentOrchestrator so
      // resolveModelFromBlueprint's ModelResolver.resolve() branch (best/route/
      // auto-admit/task_type) is reachable during real plan execution — previously
      // createAgentExecutor never received a resolver at all.
      modelResolver,
      // Phase 135 Step 11 (GAP-10, context-window half): threaded to PlanExecutor so
      // AgentOrchestrator's internally-constructed PromptBudgetAllocator resolves a step's
      // real context window (via the same edition-selected registry already used for
      // ModelResolver/CostTracker above) instead of always falling back to the
      // hardcoded 128K default — previously createAgentExecutor never received a
      // registry for its allocator at all.
      modelRegistry,
    });

    // Initialize Memory Auto-Approval Service (reuses memoryExtractor from context setup)
    const autoApprovalService = new MemoryAutoApprovalService(
      config,
      memoryExtractor,
    );

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

    // Establish all watchers (start() returns once each FS watch is open and watcher.started is
    // journalled — it does NOT block on the consume-loop). Awaiting these confirms every watcher
    // is genuinely listening before we emit daemon.started, so that event is a true "fully
    // functioning" readiness signal with no race window for a consumer that waits on it.
    const fileWatchers = [requestWatcher, planWatcher, configWatcher];
    await Promise.all(fileWatchers.map((w) => w.start()));

    // SessionReturnWatcher.start() is a blocking consume-loop (its own design), so launch it
    // detached and keep its promise for the long-lived await below — never await it for readiness.
    const longLived = fileWatchers.map((w) => w.run());
    if (sessionReturnWatcher) longLived.push(sessionReturnWatcher.start());

    // daemon.ready (NOT daemon.started): the watchers above are confirmed listening, so this is the
    // authoritative "fully functioning" signal. The CLI `daemon start` already emitted daemon.started
    // on process-alive; emitting a distinct daemon.ready here avoids two same-named events and lets a
    // consumer wait for genuine readiness (the request watcher is live) before submitting work.
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
