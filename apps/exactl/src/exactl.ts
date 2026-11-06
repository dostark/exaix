/**
 * @module ExaCtl
 * @path apps/exactl/src/exactl.ts
 * @description Main entry point for the Exaix CLI (exactl). Orchestrates all commands, subcommands, and service initializations.
 * @architectural-layer Application
 * @related-files [apps/exactl/src/init.ts]
 */

import { Command } from "@cliffy/command";
import { buildSkillCommand } from "./command_builders/skill_commands.ts";
import { PlanCommands } from "./commands/plan_commands.ts";
import { RequestCommands } from "./commands/request_commands.ts";
import { ReviewCommands } from "./commands/review_commands.ts";
import { GitCommands } from "./commands/git_commands.ts";
import { DaemonCommands } from "./commands/daemon_commands.ts";
import { ConfigCommands } from "./commands/config_commands.ts";
import { PortalCommands } from "./commands/portal_commands.ts";
import { BlueprintCommands } from "./commands/blueprint_commands.ts";
import { FlowCommands } from "./commands/flow_commands.ts";
import { DashboardCommands } from "./commands/dashboard_commands.ts";
import { MemoryCommands } from "./commands/memory_commands.ts";
import { ModelCommands } from "./commands/model_commands.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { RoutingCommands } from "./commands/routing_commands.ts";
import { WaitStateCommands } from "./commands/wait_state_commands.ts";
import { ToolCommands } from "./commands/tool_commands.ts";
import { BINARY_VERSION, scrubProcessEnv } from "@exaix/core";
import { initializeServices, type IServiceContext, isTestMode as isTestModeImport } from "./init.ts";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { WatchCommand } from "./commands/watch.ts";
import { EvalCommands } from "./commands/eval_commands.ts";
import { buildRequestCommand } from "./command_builders/request_command.ts";
import { buildPlanCommand } from "./command_builders/plan_command.ts";
import { buildReviewCommand } from "./command_builders/review_command.ts";
import { buildToolCommand, buildWaitCommand } from "./command_builders/wait_command.ts";
import { buildGitCommand } from "./command_builders/git_command.ts";
import { buildDaemonCommand, buildMigrateCommand, buildVersionCommand } from "./command_builders/daemon_command.ts";
import { buildPortalCommand } from "./command_builders/portal_command.ts";
import { buildConfigCommand } from "./command_builders/config_command.ts";
import { buildBlueprintCommand } from "./command_builders/blueprint_command.ts";
import { buildModelCommand } from "./command_builders/model_command.ts";
import { buildFlowCommand } from "./command_builders/flow_command.ts";
import { buildMemoryCommand } from "./command_builders/memory_command.ts";
import { buildDashboardCommand } from "./command_builders/dashboard_command.ts";
import { buildMcpCommand } from "./command_builders/mcp_command.ts";
import { buildEvalCommand } from "./command_builders/eval_command.ts";
import type { IExaCtlRuntime } from "./exactl_runtime.ts";
import { ExaCtlCommandName } from "./exactl_constants.ts";
import { handleExaCtlError } from "./exactl_error_handler.ts";
import { buildLogCommand } from "./command_builders/log_command.ts";

export interface IExaCtlCommandOptions {
  registerEditionCommands?: (root: typeof baseCommand, context: ICliApplicationContext) => void;
}

type ExaCtlArgumentTypes = {
  number: number;
  integer: number;
  string: string;
  boolean: boolean;
  file: string;
  secret: string;
};

type ExaCtlBaseCommand = Command<void, ExaCtlArgumentTypes, void, [], void, ExaCtlArgumentTypes, void, Command>;

// Allow tests to run the CLI entrypoint without initializing heavy services
export function isTestMode(): boolean {
  return isTestModeImport();
}

const services: IServiceContext = await initializeServices();
const fullContext: ICliApplicationContext = services;
const context = fullContext;
const db: IServiceContext["db"] = services.db;
const provider: IServiceContext["provider"] = services.provider;
const display: IServiceContext["display"] = services.display;
const gitService = services.git;
const config: ReturnType<IServiceContext["config"]["getAll"]> = services.config.getAll();

const requestCommands: RequestCommands = new RequestCommands(fullContext);
const planCommands: PlanCommands = new PlanCommands(fullContext);
const reviewCommands: ReviewCommands = new ReviewCommands(fullContext);
const gitCommands: GitCommands = new GitCommands(fullContext);
const daemonCommands: DaemonCommands = new DaemonCommands(fullContext);
const configCommands: ConfigCommands = new ConfigCommands(fullContext);
const portalCommands: PortalCommands = new PortalCommands(fullContext);
const blueprintCommands: BlueprintCommands = new BlueprintCommands(fullContext);
const routingCommands: RoutingCommands = new RoutingCommands(fullContext);
const toolCommands: ToolCommands = new ToolCommands(fullContext);
const flowCommands: FlowCommands = new FlowCommands(fullContext);
const dashboardCommands: DashboardCommands = new DashboardCommands(fullContext);
const memoryCommands: MemoryCommands = new MemoryCommands(fullContext);
const watchCommandInstance: WatchCommand = new WatchCommand(fullContext);
const waitStateCommands: WaitStateCommands = new WaitStateCommands(fullContext);
const evalCommands: EvalCommands = new EvalCommands(fullContext);
// Solo model curation CLI. Reads the model registry floor for display and writes
// curated lists to exa.config.toml (the resolver's read surface).
const modelCommands = new ModelCommands(
  fullContext.modelRegistry ??
    new DefaultModelRegistry({ checkProvider: () => Promise.resolve(true) }),
  fullContext.config.getConfigPath(),
  fullContext.benchmarkReader,
  config.model_registry?.price_staleness_max_days,
);

const runtime: IExaCtlRuntime = {
  context,
  fullContext,
  provider,
  display,
  config,
  requestCommands,
  planCommands,
  reviewCommands,
  gitCommands,
  daemonCommands,
  configCommands,
  portalCommands,
  blueprintCommands,
  routingCommands,
  flowCommands,
  dashboardCommands,
  memoryCommands,
  waitStateCommands,
  evalCommands,
  modelCommands,
  services,
  toolCommands,
  watchCommandInstance,
};

// Export test helper for unit tests to inspect module-internal context when running in test mode.
export function __test_getContext(): {
  IN_TEST_MODE: boolean;
  config: typeof config;
  db: typeof db;
  gitService: typeof gitService;
  provider: typeof provider;
  display: typeof display;
  context: typeof context;
  requestCommands: typeof requestCommands;
  planCommands: typeof planCommands;
  reviewCommands: typeof reviewCommands;
  gitCommands: typeof gitCommands;
  daemonCommands: typeof daemonCommands;
  portalCommands: typeof portalCommands;
  blueprintCommands: typeof blueprintCommands;
  flowCommands: typeof flowCommands;
  toolCommands: typeof toolCommands;
  dashboardCommands: typeof dashboardCommands;
  memoryCommands: typeof memoryCommands;
  watchCommand: typeof watchCommandInstance;
  waitStateCommands: typeof waitStateCommands;
  evalCommands: typeof evalCommands;
} {
  return {
    IN_TEST_MODE: isTestMode(),
    config,
    db,
    gitService,
    provider,
    display,
    context,
    requestCommands,
    planCommands,
    reviewCommands,
    gitCommands,
    daemonCommands,
    portalCommands,
    blueprintCommands,
    flowCommands,
    toolCommands,
    dashboardCommands,
    memoryCommands,
    watchCommand: watchCommandInstance,
    waitStateCommands,
    evalCommands,
  };
}

export type ExaCtlTestContext = ReturnType<typeof __test_getContext>;

// Test helper: initialize the heavy services path (same logic used in non-test runtime)
// Returns an object describing whether initialization succeeded and the constructed services.
export function __test_initializeServices(
  opts?: Opt<{ simulateFail?: boolean; instantiateDb?: boolean; configPath?: string }, Reason.TestOverride>,
): ReturnType<typeof initializeServices> {
  return initializeServices(opts);
}

const baseCommand: ExaCtlBaseCommand = new Command()
  .name("exactl")
  .version(BINARY_VERSION)
  .description("Exaix CLI - Human interface for agent orchestration")
  // Request commands (PRIMARY INTERFACE)
  .command(
    ExaCtlCommandName.REQUEST,
    buildRequestCommand(runtime),
  )
  // Plan commands
  .command(
    ExaCtlCommandName.PLAN,
    buildPlanCommand(runtime),
  )
  // Review commands (replaces review commands)
  .command(
    ExaCtlCommandName.REVIEW,
    buildReviewCommand(runtime),
  )
  // Wait state commands
  .command(
    ExaCtlCommandName.WAIT,
    buildWaitCommand(runtime),
  )
  // Git commands
  .command(
    ExaCtlCommandName.GIT,
    buildGitCommand(runtime),
  )
  // Daemon commands
  .command(
    ExaCtlCommandName.DAEMON,
    buildDaemonCommand(runtime),
  )
  // Portal commands
  .command(
    ExaCtlCommandName.PORTAL,
    buildPortalCommand(runtime),
  )
  // Config commands
  .command(
    ExaCtlCommandName.CONFIG,
    buildConfigCommand(runtime),
  )
  // Blueprint commands
  .command(
    ExaCtlCommandName.BLUEPRINT,
    buildBlueprintCommand(runtime),
  )
  // Flow commands
  .command(
    ExaCtlCommandName.FLOW,
    buildFlowCommand(runtime),
  )
  // Memory commands
  .command(
    ExaCtlCommandName.MEMORY,
    buildMemoryCommand(runtime),
  )
  .command(
    ExaCtlCommandName.DASHBOARD,
    buildDashboardCommand(runtime),
  )
  .command(
    ExaCtlCommandName.MCP,
    buildMcpCommand(runtime),
  );

baseCommand
  .command(ExaCtlCommandName.LOG, buildLogCommand(runtime))
  .command(ExaCtlCommandName.MODEL, buildModelCommand(runtime))
  .command(ExaCtlCommandName.VERSION, buildVersionCommand(runtime))
  .command(ExaCtlCommandName.MIGRATE, buildMigrateCommand(runtime))
  .command(ExaCtlCommandName.TOOL, buildToolCommand(runtime))
  .command(ExaCtlCommandName.SKILL, buildSkillCommand(runtime))
  .command(ExaCtlCommandName.EVAL, buildEvalCommand(runtime));

// cliffy attaches .error() to the last registered command unless reset() runs first.
baseCommand.reset().error((error) => handleExaCtlError(error, Deno.args, Deno.exit, baseCommand));

const editionRegistrations = new Set<IExaCtlCommandOptions["registerEditionCommands"]>();

/** Returns the single initialized CLI command tree, applying edition contributions before parsing. */
export function createExaCtlCommand(options: IExaCtlCommandOptions = {}): typeof baseCommand {
  const registration = options.registerEditionCommands;
  if (registration !== undefined && !editionRegistrations.has(registration)) {
    registration(baseCommand, context);
    editionRegistrations.add(registration);
  }
  return baseCommand;
}

export const __test_command: typeof baseCommand = createExaCtlCommand();

export async function run(command: typeof baseCommand = createExaCtlCommand()): Promise<void> {
  // Scrub ambient injection-class env vars (LD_*, NODE_OPTIONS, git env-config, …)
  // before any command dispatch or subprocess spawn — the daemon spawned by
  // `daemon start` inherits this process env, and scrubs its own env too.
  scrubProcessEnv();

  await command.parse(Deno.args);
  if (services.db && services.db.close) {
    await services.db.close();
  }
}

if (import.meta.main && !isTestMode()) {
  await run();
}
