/**
 * @module CLIInit
 * @path src/cli/init.ts
 * @description Handles CLI service initialization, including configuration loading, database connection, and model provider setup, with specific handling for test modes.
 * @architectural-layer CLI
 * @related-files [src/cli/main.ts, src/cli/exactl.ts]
 */

import { join } from "@std/path";
import { ConfigService } from "../config/service.ts";
import { GitService } from "../services/core/git_service.ts";
import { EventLogger } from "../services/core/event_logger.ts";
import { ProviderFactory } from "../ai/provider_factory.ts";
import { FlowLoader } from "../flows/flow_loader.ts";
import { ExaPathDefaults } from "@exaix/core";
import type { Config } from "@exaix/schemas/config.ts";
import { DatabaseService, type IDatabaseService } from "../services/core/db.ts";
import { ToolRegistry } from "../services/tool/tool_registry.ts";
import type { IModelProvider } from "../ai/types.ts";
import type { ICliApplicationContext, IPortalKnowledgeConfig } from "./cli_context.ts";
import { createGitServiceStub, createProviderStub } from "../shared/helpers/stub_factories.ts";
import { ActivityActor } from "@exaix/core";

// Concrete services for adapters
import { MemoryBankService } from "../services/memory/memory_bank.ts";
import { MemoryExtractorService } from "../services/memory/memory_extractor.ts";
import { MemoryEmbeddingService } from "../services/memory/memory_embedding.ts";
import { SkillsService } from "../services/skills/skills.ts";
import { ArchiveService } from "../services/artifact/archive_service.ts";
import { FlowValidatorImpl } from "../services/flow/flow_validator.ts";
import { ContextCardGenerator } from "../services/context/context_card_generator.ts";
import { PortalService } from "../services/portal/portal.ts";
import { RequestService } from "../services/request/request.ts";
import { PlanService } from "../services/plan/plan.ts";
import { PlanAmendmentService } from "../services/plan/plan_amendment_service.ts";
import { PortalKnowledgeService } from "../services/portal_knowledge/portal_knowledge_service.ts";

// Adapters
import {
  ArchiveAdapter,
  ConfigAdapter,
  ContextCardAdapter,
  DisplayAdapter,
  FlowValidatorAdapter,
  MemoryBankAdapter,
  MemoryEmbeddingAdapter,
  MemoryExtractorAdapter,
  PlanAdapter,
  PlanAmendmentAdapter,
  PortalAdapter,
  RequestAdapter,
  SkillsAdapter,
} from "../services/adapters/mod.ts";
import { OutputValidator } from "../services/tool/output_validator.ts";

export interface IServiceContext extends ICliApplicationContext {
  success: boolean;
  error?: string;
}

export type ServiceContext = IServiceContext;

// Helper to create IDatabaseService-compatible stub
function createDatabaseStub(): IDatabaseService {
  return {
    logActivity: () => {},
    waitForFlush: async () => {},
    queryActivity: () => Promise.resolve([]),
    close: async () => {},
    preparedGet: () => Promise.resolve(null),
    preparedAll: () => Promise.resolve([]),
    preparedRun: () => Promise.resolve({}),
    getActivitiesByTrace: () => [],
    getActivitiesByTraceSafe: () => Promise.resolve([]),
    getActivitiesByActionType: () => [],
    getActivitiesByActionTypeSafe: () => Promise.resolve([]),
    getRecentActivity: () => Promise.resolve([]),
  };
}

// Allow tests to run the CLI entrypoint without initializing heavy services
export function isTestMode(): boolean {
  return Deno.env.get("EXA_TEST_MODE") === "1" || Deno.args.includes("--test");
}

// Test helper: initialize the heavy services path (same logic used in non-test runtime)
// Returns an object describing whether initialization succeeded and the constructed services.
export async function initializeServices(
  opts?: { simulateFail?: boolean; instantiateDb?: boolean; configPath?: string },
): Promise<ServiceContext> {
  try {
    if (opts?.simulateFail) throw new Error("simulate-failure");
    let configPath = opts?.configPath;
    if (!configPath && isTestMode()) {
      // In test mode, use a temp directory to avoid polluting the root
      const tempDir = await Deno.makeTempDir({ prefix: "exactl-test-" });
      configPath = `${tempDir}/exa.config.toml`;
    }
    const cfgService = new ConfigService(configPath);
    const cfg = cfgService.get();

    // Dynamically import DatabaseService as the runtime code does
    // Only import and instantiate DatabaseService if explicitly requested by caller.
    // Importing the DB module may load native dynamic libraries during module initialization,
    // which unit tests need to avoid unless they're prepared to close them.
    let dbLocal: IDatabaseService;
    if (opts?.instantiateDb) {
      dbLocal = new DatabaseService(cfg);
      if (dbLocal.close) {
        try {
          await dbLocal.close();
        } catch {
          // ignore close errors in test helper
        }
      }
    } else if (!isTestMode()) {
      dbLocal = new DatabaseService(cfg);
    } else {
      // Stub db with no-op methods to prevent crashes
      dbLocal = createDatabaseStub();
    }

    const gitLocal = new GitService({ config: cfg, db: dbLocal });
    // For provider, ensure we have a valid model name or fallback
    const model = cfg.agents?.default_model || "mock:test";
    const providerLocal = await ProviderFactory.createByName(cfg, model);
    const displayLogger = new EventLogger({ db: dbLocal });
    const displayAdapter = new DisplayAdapter(displayLogger);
    const configAdapter = new ConfigAdapter(cfgService);

    const userIdentityGetter = async () => {
      return await Promise.resolve("cli-user");
    };

    // Instantiate concrete services and group into adapters
    const memoryBank = new MemoryBankService(cfg, dbLocal);
    const extractor = new MemoryExtractorService(cfg, dbLocal, memoryBank);
    const embedding = new MemoryEmbeddingService(cfg);
    const skills = new SkillsService({
      memoryDir: join(cfg.system.root!, cfg.paths.memory!),
      portal: cfg.paths.workspace,
    }, dbLocal);
    const archive = new ArchiveService(join(cfg.system.root!, cfg.paths.archive!));
    const flowsPath = join(cfg.system.root!, cfg.paths.flows!);
    const flowLoader = new FlowLoader(flowsPath);
    const blueprintsPath = join(cfg.system.root!, cfg.paths.blueprints!);
    const flowValidator = new FlowValidatorImpl(flowLoader, blueprintsPath);
    const contextCards = new ContextCardGenerator(cfg);

    const validatorLocal = new OutputValidator();
    const portalKnowledgeConfig: IPortalKnowledgeConfig = {
      autoAnalyzeOnMount: cfg.portal_knowledge.auto_analyze_on_mount,
      defaultMode: cfg.portal_knowledge.default_mode,
      quickScanLimit: cfg.portal_knowledge.quick_scan_limit,
      maxFilesToRead: cfg.portal_knowledge.max_files_to_read,
      staleness: cfg.portal_knowledge.staleness_hours,
      useLlmInference: cfg.portal_knowledge.use_llm_inference,
      ignorePatterns: cfg.portal_knowledge.ignore_patterns,
    };

    const portalKnowledge = new PortalKnowledgeService({
      config: portalKnowledgeConfig,
      memoryBank,
      provider: providerLocal,
      db: dbLocal,
    });

    const toolRegistry = new ToolRegistry({
      config: cfg,
      db: dbLocal as DatabaseService, // ToolRegistry expects concrete DatabaseService
    });

    const context: ICliApplicationContext = {
      db: dbLocal,
      git: gitLocal,
      provider: providerLocal,
      display: displayAdapter,
      config: configAdapter,
      toolRegistry,
    };

    const portals = new PortalService(
      cfg,
      configAdapter,
      contextCards,
      displayAdapter,
      portalKnowledge,
      portalKnowledgeConfig,
    );

    const requests = new RequestService({
      context,
      userIdentityGetter,
      validator: validatorLocal,
      config: cfg,
      configService: cfgService,
      display: displayAdapter,
    });

    const plans = new PlanService(cfg, configAdapter, dbLocal, displayAdapter, userIdentityGetter);
    const amendments = new PlanAmendmentService(cfg, providerLocal);

    context.requests = new RequestAdapter(requests);
    context.portals = new PortalAdapter(portals);
    context.plans = new PlanAdapter(plans);
    context.amendments = new PlanAmendmentAdapter(amendments);
    context.memoryBank = new MemoryBankAdapter(memoryBank);
    context.extractor = new MemoryExtractorAdapter(extractor);
    context.embeddings = new MemoryEmbeddingAdapter(embedding);
    context.skills = new SkillsAdapter(skills);
    context.archive = new ArchiveAdapter(archive);
    context.flowValidator = new FlowValidatorAdapter(flowValidator);
    context.contextCards = new ContextCardAdapter(contextCards);
    context.portalKnowledge = portalKnowledge;

    return {
      success: true,
      ...context,
      portalKnowledgeConfig,
    };
  } catch (err) {
    // Fallback minimal stubs (same as runtime fallback)
    const cfg = {
      system: { root: Deno.cwd() },
      paths: { ...ExaPathDefaults },
      agents: { default_model: "mock:test" },
    } as Config;

    // Attempt to create provider even in fallback, or stub
    let providerLocal: IModelProvider;
    try {
      providerLocal = await ProviderFactory.createByName(cfg, cfg.agents.default_model);
    } catch {
      // Create minimal provider stub
      providerLocal = createProviderStub();
    }

    const displayLocal = new EventLogger({});
    displayLocal.warn("cli.config_missing", ActivityActor.SYSTEM, {
      message: `Configuration failed to load (${err}). Running in degraded mode (read-only/stub).`,
      hint: "Ensure 'exa.config.toml' exists in current directory or root.",
    });

    return {
      success: false,
      error: String(err),
      db: createDatabaseStub(),
      git: createGitServiceStub(),
      provider: providerLocal,
      display: new DisplayAdapter(displayLocal),
      config: new ConfigAdapter(new ConfigService()),
      // Minimal optional adapters can be undefined in fallback
    };
  }
}
