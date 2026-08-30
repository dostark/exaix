/**
 * @module TuiServiceFactory
 * @path apps/tui/src/services/tui_service_factory.ts
 * @description Factory for creating service instances used by the TUI dashboard.
 * This module bridges the core services with the TUI interface layer.
 * @architectural-layer Services
 * @ungrounded
 * @related-files [apps/tui/src/dashboard/view_registry.ts, apps/exactl/src/commands/dashboard_commands.ts]
 */

import { join } from "@std/path";
import { PlanCommands } from "../../../../apps/exactl/src/commands/plan_commands.ts";
import { RequestCommands } from "../../../../apps/exactl/src/commands/request_commands.ts";
import { DaemonCommands } from "../../../../apps/exactl/src/commands/daemon_commands.ts";
import { PortalAdapter } from "../../../common/adapters/portal_adapter.ts";
import { PlanAdapter } from "../../../common/adapters/plan_adapter.ts";
import { RequestAdapter } from "../../../common/adapters/request_adapter.ts";
import { DaemonServiceAdapter } from "../../../common/adapters/daemon_adapter.ts";
import { AgentServiceAdapter } from "../../../common/adapters/agent_adapter.ts";
import { MemoryServiceAdapter } from "../../../common/adapters/memory_adapter.ts";
import { JournalServiceAdapter } from "../../../common/adapters/journal_adapter.ts";
import { LogServiceAdapter } from "../../../common/adapters/log_adapter.ts";
import { ContextCardAdapter } from "../../../common/adapters/context_card_adapter.ts";
import { EventLogger, EventLoggerStructuredOutput } from "@exaix/core/logger";
import type { IEventLoggerOutput } from "@exaix/core/logger";
import { DisplayAdapter } from "../../../common/adapters/display_adapter.ts";
import { ContextCardGenerator } from "@exaix/core/context";
import { PortalService } from "@exaix/portal";
import { createGitServiceStub } from "@exaix/testing/helpers/stub_factories.ts";
import { MemoryBankService } from "@exaix/memory";
import { MemoryExtractorService } from "@exaix/memory";
import { SkillsService } from "@exaix/core/skills";
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
import type { IDaemonService, IDatabaseService, IJournalService, ILogService, IMemoryService } from "@exaix/core/types";
import type { IStructuredLogger } from "@exaix/core/types";
import type { JSONValue, Opt, Reason } from "@exaix/core/types";
import type { Config } from "@exaix/schemas";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";
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

/** Bridges core services with TUI interfaces. */
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
      return "";
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
  const contextCardGenerator = new ContextCardAdapter(
    new ContextCardGenerator(config, new EventLogger({ db: databaseService })),
  );
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

  // Initialize EventLogger with viewer-compatible output
  const viewerLogDir = join(config.system.root!, "logs", "event-viewer");
  const logOutput = new EventLoggerStructuredOutput(viewerLogDir);
  const eventLogger = new EventLogger({
    db: databaseService,
    outputs: [logOutput],
  });

  // Adapter: IStructuredLogger (ILogger) from EventLogger for backward compat
  const structuredLogger: IStructuredLogger = {
    setContext: () => {},
    child: () => structuredLogger,
    debug: (message, metadata) => {
      eventLogger.debug(message, "", metadata as Record<string, JSONValue>);
    },
    info: (message, metadata) => {
      eventLogger.info(message, "", metadata as Record<string, JSONValue>);
    },
    warn: (message, metadata) => {
      eventLogger.warn(message, "", metadata as Record<string, JSONValue>);
    },
    error: (message, error, metadata) => {
      eventLogger.error(message, "", {
        ...metadata as Record<string, JSONValue>,
        error: (error as Error)?.message ?? String(error),
      });
    },
    fatal: (message, error, metadata) => {
      eventLogger.fatal(message, "", {
        ...metadata as Record<string, JSONValue>,
        error: (error as Error)?.message ?? String(error),
      });
    },
    time: async <T>(
      _op: string,
      fn: () => Promise<T>,
      _metadata?: Opt<Record<string, JSONValue>, Reason.AbstractBoundary>,
    ): Promise<T> => await fn(),
  };

  // Wrap the output in a logger-like object for LogServiceAdapter
  const outputLogger = { getOutputs: () => [logOutput] as IEventLoggerOutput[] };
  const structuredLoggerService: ILogService = new LogServiceAdapter(outputLogger);

  // Initialize memory services
  const memoryBank = new MemoryBankService(config);
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
