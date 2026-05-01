/**
 * @module TuiServiceFactory
 * @path src/services/utils/tui_service_factory.ts
 * @description Factory for creating service instances used by the TUI dashboard.
 * This module bridges the core services with the TUI interface layer.
 * @architectural-layer Services
 * @related-files [src/tui/dashboard/view_registry.ts, src/cli/commands/dashboard_commands.ts]
 */

import { join } from "@std/path";
import { PlanCommands } from "../../cli/commands/plan_commands.ts";
import { RequestCommands } from "../../cli/commands/request_commands.ts";
import { DaemonCommands } from "../../cli/commands/daemon_commands.ts";
import { PortalAdapter } from "../adapters/portal_adapter.ts";
import { PlanAdapter } from "../adapters/plan_adapter.ts";
import { RequestAdapter } from "../adapters/request_adapter.ts";
import { DaemonServiceAdapter } from "../adapters/daemon_adapter.ts";
import { AgentServiceAdapter } from "../adapters/agent_adapter.ts";
import { MemoryServiceAdapter } from "../adapters/memory_adapter.ts";
import { JournalServiceAdapter } from "../adapters/journal_adapter.ts";
import { LogServiceAdapter } from "../adapters/log_adapter.ts";
import { ContextCardAdapter } from "../adapters/context_card_adapter.ts";
import { getGlobalLogger } from "@exaix/core/logger/structured_logger.ts";
import { EventLogger } from "@exaix/core/logger/event_logger.ts";
import { DisplayAdapter } from "../adapters/display_adapter.ts";
import { ContextCardGenerator } from "../context/context_card_generator.ts";
import { PortalService } from "../portal/portal.ts";
import { createGitServiceStub } from "@exaix/testing/helpers/stub_factories.ts";
import { MemoryBankService } from "../memory/memory_bank.ts";
import { MemoryExtractorService } from "../memory/memory_extractor.ts";
import { SkillsService } from "../skills/skills.ts";
import { GitBranchName } from "@exaix/git";
import type {
  IAgentService,
  IConfigService,
  IPlanService,
  IPortalConfigEntry,
  IPortalService,
  IRequestService,
  ISkillsService,
} from "@exaix/core/types";
import type {
  IDaemonService,
  IDatabaseService,
  IJournalService,
  ILogService,
  IMemoryService,
  IStructuredLogger,
} from "@exaix/core/types";
import type { Config } from "@exaix/schemas";
import type { ICliApplicationContext } from "../../cli/cli_context.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
/**
 * Service bundle for TUI initialization
 */
export interface ITuiServiceBundle {
  portalService: IPortalService;
  planService: IPlanService;
  journalService: IJournalService;
  structuredLogger: IStructuredLogger;
  structuredLoggerService: ILogService;
  daemonService: IDaemonService;
  agentService: IAgentService;
  requestService: IRequestService;
  memoryService: IMemoryService;
  skillsService: ISkillsService;
}

/**
 * Options for creating TUI services
 */
export interface ITuiServiceFactoryOptions {
  config: Config;
  databaseService: IDatabaseService;
}

/**
 * Create all services needed by the TUI dashboard.
 * This function bridges core services with TUI interfaces.
 */
export function createTuiServices(
  options: ITuiServiceFactoryOptions,
): ITuiServiceBundle {
  const { config, databaseService } = options;

  // Create command context for CLI commands
  const configService: IConfigService = {
    get(): Config {
      return config;
    },
    getAll(): Config {
      return config;
    },
    getConfigPath(): string {
      return "exa.config.toml";
    }, // dummy path
    reload(): Config {
      return config;
    },
    addPortal: () => {
      return Promise.reject(new Error("Not implemented in TUI context"));
    },
    removePortal: () => {
      return Promise.reject(new Error("Not implemented in TUI context"));
    },
    getPortals(): IPortalConfigEntry[] {
      return config.portals || [];
    },
    getPortal: (alias: string) => (config.portals || []).find((p) => p.alias === alias),
    getSchemaVersion(): string {
      return "1.0.0"; // dummy schema version for TUI context
    },
  };

  const providerStub: IModelProvider = {
    id: "tui-provider-stub",
    generate: () =>
      Promise.resolve({
        content: "",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "stub-model",
        provider: "mock",
        cost_usd: 0,
      }),
  };

  const gitStub = createGitServiceStub({
    getRepository: () => config.system.root,
    getDefaultBranch: () => Promise.resolve(GitBranchName.MAIN),
  });

  const displayAdapter = new DisplayAdapter(new EventLogger({ prefix: "[TUI]" }));

  const context: ICliApplicationContext = {
    config: configService,
    db: databaseService,
    display: displayAdapter,
    provider: providerStub,
    git: gitStub,
  };

  // Create service adapters that implement TUI interfaces
  const contextCardGenerator = new ContextCardAdapter(new ContextCardGenerator(config, databaseService));
  const portalService: IPortalService = new PortalAdapter(
    new PortalService(config, configService, contextCardGenerator, displayAdapter),
  );
  const planService: IPlanService = new PlanAdapter(
    new PlanCommands(context),
  );
  const journalService: IJournalService = new JournalServiceAdapter(databaseService);
  const requestService: IRequestService = new RequestAdapter(
    new RequestCommands(context),
  );
  const daemonService: IDaemonService = new DaemonServiceAdapter(
    new DaemonCommands(context),
  );
  const agentService: IAgentService = new AgentServiceAdapter(context);

  // Initialize structured logger
  const logger = getGlobalLogger();
  const structuredLogger: IStructuredLogger = logger;
  const structuredLoggerService: ILogService = new LogServiceAdapter(logger);

  // Initialize memory services
  const memoryBank = new MemoryBankService(config, databaseService);
  const extractor = new MemoryExtractorService(config, databaseService, memoryBank);
  const memoryService: IMemoryService = new MemoryServiceAdapter(memoryBank, extractor);

  // Initialize skills service
  const memoryDir = join(config.system.root!, config.paths.memory!);
  const skillsService: ISkillsService = new SkillsService({ memoryDir }, databaseService);

  return {
    portalService,
    planService,
    journalService,
    structuredLogger,
    structuredLoggerService,
    daemonService,
    agentService,
    requestService,
    memoryService,
    skillsService,
  };
}
