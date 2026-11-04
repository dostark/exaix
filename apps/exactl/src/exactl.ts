/**
 * @module ExaCtl
 * @path apps/exactl/src/exactl.ts
 * @description Main entry point for the Exaix CLI (exactl). Orchestrates all commands, subcommands, and service initializations.
 * @architectural-layer Application
 * @related-files [apps/exactl/src/init.ts]
 */

import { Command } from "@cliffy/command";
import { registerSkillCommands } from "./command_builders/skill_commands.ts";
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
import {
  type IJournalCommandOptions,
  type IJournalWaitOptions,
  JournalCommands,
  normalizeLogsFilter,
} from "./commands/journal_commands.ts";
import { CostCommands } from "./commands/cost_commands.ts";
import { ModelCommands } from "./commands/model_commands.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { RoutingCommands } from "./commands/routing_commands.ts";
import { WaitStateCommands } from "./commands/wait_state_commands.ts";
import { ToolCommands } from "./commands/tool_commands.ts";
import { BINARY_VERSION, DEFAULT_UNKNOWN_ERROR_MESSAGE, scrubProcessEnv, WORKSPACE_SCHEMA_VERSION } from "@exaix/core";
import { CLI_OUTPUT_FORMATS } from "@exaix/cli/config.ts";
import { initializeServices, type IServiceContext, isTestMode as isTestModeImport } from "./init.ts";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { WatchCommand } from "./commands/watch.ts";
import { EvalCommands } from "./commands/eval_commands.ts";
import { buildRequestCommand } from "./command_builders/request_command.ts";
import { buildPlanCommand } from "./command_builders/plan_command.ts";
import { buildReviewCommand } from "./command_builders/review_command.ts";
import { buildWaitCommand } from "./command_builders/wait_command.ts";
import { buildGitCommand } from "./command_builders/git_command.ts";
import { buildDaemonCommand } from "./command_builders/daemon_command.ts";
import { buildPortalCommand } from "./command_builders/portal_command.ts";
import { buildConfigCommand } from "./command_builders/config_command.ts";
import { buildBlueprintCommand } from "./command_builders/blueprint_command.ts";
import { buildRoutingCommand } from "./command_builders/routing_command.ts";
import { buildFlowCommand } from "./command_builders/flow_command.ts";
import { buildMemoryCommand } from "./command_builders/memory_command.ts";
import { buildDashboardCommand } from "./command_builders/dashboard_command.ts";
import { buildMcpCommand } from "./command_builders/mcp_command.ts";
import { buildEvalCommand } from "./command_builders/eval_command.ts";
import type { IExaCtlRuntime } from "./exactl_runtime.ts";
import {
  CLI_OPTION_MODEL,
  CLI_OPTION_PORTAL,
  CLI_OPTION_REASON,
  CLI_OUTPUT_FORMAT_OPTION,
  ExaCtlCommandName,
  ExaCtlJournalSubcommand,
} from "./exactl_constants.ts";

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
const memorySkillCommand = new Command().description("Manage procedural skills");
registerSkillCommands(memorySkillCommand, memoryCommands);
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
  memorySkillCommand,
  waitStateCommands,
  evalCommands,
  modelCommands,
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
  .command(
    ExaCtlCommandName.ROUTING,
    buildRoutingCommand(runtime),
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

const journalCommand = new Command()
  .description("Query the IActivity Journal")
  .option("-f, --filter <filter:string>", "Filter by key=value (trace_id, action_type, agent_role, since)", {
    collect: true,
  })
  .option("-n, --tail <n:number>", "Show last N entries", { default: 50 })
  .option(CLI_OUTPUT_FORMAT_OPTION, "Output format (text, table, json)", { default: CLI_OUTPUT_FORMATS.TEXT })
  .option("--distinct <field:string>", "Return distinct values for specified field")
  .option("--count", "Return count aggregation by action_type")
  .option("--payload <pattern:string>", "Filter by payload LIKE pattern")
  .option("--actor <actor:string>", "Filter by actor")
  .option("--target <target:string>", "Filter by target")
  .action(async (options) => {
    const cmd = new JournalCommands(context);
    await cmd.show(options as IJournalCommandOptions);
  })
  .command(
    ExaCtlJournalSubcommand.WAIT,
    new Command()
      .description("Block until an event is journalled after a baseline (or timeout)")
      .option("--event <event:string>", "Action type to wait for (repeatable — OR semantics, e.g. daemon.ready)", {
        collect: true,
      })
      .option(
        "--since <since:string>",
        "Only count events timestamped after this ISO datetime (default: events arriving while waiting)",
      )
      .option(
        "--since-rowid <since-rowid:number>",
        "Only count events with rowid above this internal baseline (scenario framework use)",
        { hidden: true },
      )
      .option("--timeout <timeout:number>", "Max wait in seconds", { default: 30 })
      .option("--payload <pattern:string>", "Only count events whose payload matches this LIKE pattern")
      .action(async (options) => {
        const cmd = new JournalCommands(context);
        await cmd.wait(options as IJournalWaitOptions);
      }),
  )
  .command(
    "verify",
    new Command()
      .description("Verify the activity hash chain (exit 1 when tampered)")
      .action(async () => {
        const cmd = new JournalCommands(context);
        const code = await cmd.verify();
        if (code !== 0) Deno.exit(code);
      }),
  );

const createCostCommand = () =>
  new Command()
    .description("Display aggregated cost reports")
    .option("-t, --trace-id <id:string>", "Filter by trace ID")
    .option(CLI_OPTION_PORTAL, "Filter by portal alias")
    .option("-s, --since <date:string>", "Filter by date (ISO string)")
    .option(CLI_OPTION_MODEL, "Filter by model")
    .option("--group-by <dimension:string>", "Group costs by model, portal, or role")
    .action(async (options) => {
      const cmd = new CostCommands(context);
      await cmd.show(options);
    });

const logCommand = new Command()
  .description("Access system logs, activity journal and cost tracking")
  .command(ExaCtlCommandName.JOURNAL, journalCommand)
  .command(ExaCtlCommandName.COST, createCostCommand());

baseCommand.command(ExaCtlCommandName.COST, createCostCommand());

const logsCommand = new Command()
  .description("Query system activity logs (alias for 'log journal')")
  .option("-f, --filter <filter:string>", "Filter by key=value or bare event name (e.g., model_resolved)", {
    collect: true,
  })
  .option("-n, --tail <n:number>", "Show last N entries", { default: 50 })
  .option(CLI_OUTPUT_FORMAT_OPTION, "Output format (text, table, json)", { default: CLI_OUTPUT_FORMATS.TEXT })
  .option("--payload <pattern:string>", "Filter by payload LIKE pattern")
  .option("--actor <actor:string>", "Filter by actor")
  .option("--target <target:string>", "Filter by target")
  .action(async (options) => {
    if (options.filter) {
      options.filter = normalizeLogsFilter(options.filter);
    }
    const cmd = new JournalCommands(context);
    await cmd.show(options as IJournalCommandOptions);
  });

baseCommand.command(ExaCtlCommandName.LOG, logCommand);
baseCommand.command(ExaCtlCommandName.LOGS, logsCommand);
baseCommand.command(ExaCtlCommandName.JOURNAL, journalCommand);

// models subcommand (Solo model registry display)

const modelsCommand = new Command()
  .description("Inspect the Solo model registry floor (models list/pricing)")
  .command(
    "list",
    new Command()
      .description("List registry models with provenance and verified_at staleness")
      .option("--benchmark <benchmark:string>", "Show the advisory score column for a tracked benchmark (Team)")
      .action(async (options) => {
        try {
          await modelCommands.listModels(options);
        } catch (error) {
          display.error("cli.error", "models list", {
            message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
          });
          Deno.exit(1);
        }
      }),
  )
  .command(
    "pricing",
    new Command()
      .description("Show per-Mtok model prices with provenance")
      .action(async () => {
        try {
          await modelCommands.showPricing();
        } catch (error) {
          display.error("cli.error", "models pricing", {
            message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
          });
          Deno.exit(1);
        }
      }),
  )
  .command(
    "refresh",
    new Command()
      .description("Trigger a Team live-registry catalog refresh (Team + model_registry.enabled only)")
      .action(async () => {
        try {
          await modelCommands.refreshModels();
        } catch (error) {
          display.error("cli.error", "models refresh", {
            message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
          });
          Deno.exit(1);
        }
      }),
  );

baseCommand.command(ExaCtlCommandName.MODELS, modelsCommand);

// version subcommand

const versionCommand = new Command()
  .description("Show Exaix binary and workspace schema version information")
  .option("--json", "Output as JSON")
  .action((options) => {
    const onDiskSchemaVersion = (() => {
      try {
        return services.config.getSchemaVersion();
      } catch {
        return WORKSPACE_SCHEMA_VERSION;
      }
    })();

    const wsv = parseSemVerSegments(WORKSPACE_SCHEMA_VERSION);
    const ondisk = parseSemVerSegments(onDiskSchemaVersion);

    const migrationRequired = wsv.major > ondisk.major ||
      (wsv.major === ondisk.major && wsv.minor > ondisk.minor);
    const binaryTooOld = ondisk.major > wsv.major ||
      (ondisk.major === wsv.major && ondisk.minor > wsv.minor);
    const compatible = !migrationRequired && !binaryTooOld;

    const compatibilityLabel = migrationRequired
      ? "⚠️  Minor migration required"
      : binaryTooOld
      ? "❌ Binary older than workspace — update exactl"
      : "✅ OK";

    if (options.json) {
      const configPath = (() => {
        try {
          return services.config.getConfigPath();
        } catch {
          return "";
        }
      })();
      console.log(
        JSON.stringify({
          binary_version: BINARY_VERSION,
          workspace_schema_version: WORKSPACE_SCHEMA_VERSION,
          on_disk_schema_version: onDiskSchemaVersion,
          compatible,
          migration_required: migrationRequired,
          config_path: configPath,
        }),
      );
      return;
    }

    const configPath = (() => {
      try {
        return services.config.getConfigPath();
      } catch {
        return "(not available)";
      }
    })();

    console.log("Exaix CLI");
    console.log(`  Binary version:             ${BINARY_VERSION}`);
    console.log(`  Workspace schema version:   ${WORKSPACE_SCHEMA_VERSION}`);
    console.log(`  Config path:                ${configPath}`);
    console.log(`  On-disk schema version:     ${onDiskSchemaVersion}`);
    console.log(`  Compatibility:              ${compatibilityLabel}`);
  });

/** Minimal inline SemVer parser (avoids circular import of scripts/check_version.ts) */
function parseSemVerSegments(v: string): { major: number; minor: number; patch: number } {
  const [major, minor, patch] = v.split(".").map(Number);
  return { major: major ?? 0, minor: minor ?? 0, patch: patch ?? 0 };
}

baseCommand.command(ExaCtlCommandName.VERSION, versionCommand);

// migrate subcommand

const migrateCommand = new Command()
  .description("Workspace migration utilities")
  .command(
    "check",
    new Command()
      .description("Check binary vs workspace schema compatibility")
      .option("--json", "Output as JSON")
      .action((options) => {
        const exitCode = daemonCommands.migrate({ check: true, json: options.json });
        Deno.exit(exitCode);
      }),
  );

baseCommand.command(ExaCtlCommandName.MIGRATE, migrateCommand);

// tool subcommand (Tool Confirmation CLI)

const toolCommand = new Command()
  .description("Manage pending tool confirmations")
  .command(
    "pending",
    new Command()
      .description("List pending tool confirmations")
      .action(async () => {
        await toolCommands.pending();
      }),
  )
  .command(
    "confirm <id:string>",
    new Command()
      .description("Approve a pending tool confirmation")
      .action(async (_options, ...args: string[]) => {
        const id = args[0];
        await toolCommands.confirm(id);
      }),
  )
  .command(
    "deny <id:string>",
    new Command()
      .description("Deny a pending tool confirmation")
      .option(CLI_OPTION_REASON, "Reason for denial", { default: "User declined" })
      .action(async (options: { reason: string }, ...args: string[]) => {
        const id = args[0];
        await toolCommands.deny(id, options.reason as string);
      }),
  );

baseCommand.command(ExaCtlCommandName.TOOL, toolCommand);

// skills subcommand alias (wires the Skills Service)

const skillsCommand = new Command().description("Manage procedural skills (alias of 'memory skill')");
registerSkillCommands(skillsCommand, memoryCommands);

baseCommand.command(ExaCtlCommandName.SKILLS, skillsCommand);

// watch subcommand (live execution streaming)

const watchCommand = new Command()
  .description("Tail live execution events for a trace (SSE stream with historical fallback)")
  .arguments("<trace_id:string>")
  .action(async (_options, traceId: string) => {
    try {
      await watchCommandInstance.watch(traceId);
    } catch (error) {
      display.error("cli.error", "watch", {
        message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
      });
      Deno.exit(1);
    }
  });

baseCommand.command(ExaCtlCommandName.WATCH, watchCommand);

// eval subcommand (evaluation framework)

const evalCommand = buildEvalCommand(runtime);

baseCommand.command(ExaCtlCommandName.EVAL, evalCommand);

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
