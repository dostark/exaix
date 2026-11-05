/**
 * @module ExaCtlLogCommand
 * @path apps/exactl/src/command_builders/log_command.ts
 * @description Builds the exactl journal, cost, log and logs commands over the activity journal and the cost report.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/commands/journal_commands.ts]
 */

import { Command } from "@cliffy/command";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import {
  type IJournalCommandOptions,
  type IJournalWaitOptions,
  JournalCommands,
  normalizeLogsFilter,
} from "../commands/journal_commands.ts";
import { CostCommands } from "../commands/cost_commands.ts";
import { CLI_OUTPUT_FORMATS } from "@exaix/cli/config.ts";
import {
  CLI_OPTION_MODEL,
  CLI_OPTION_PORTAL,
  CLI_OUTPUT_FORMAT_OPTION,
  ExaCtlCommandName,
  ExaCtlJournalSubcommand,
} from "../exactl_constants.ts";

function createJournalCommand(runtime: IExaCtlRuntime) {
  const { context } = runtime;
  return new Command()
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
}

export function buildJournalCommand(runtime: IExaCtlRuntime): ReturnType<typeof createJournalCommand> {
  return createJournalCommand(runtime);
}

function createCostCommand(runtime: IExaCtlRuntime) {
  const { context } = runtime;
  return new Command()
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
}

export function buildCostCommand(runtime: IExaCtlRuntime): ReturnType<typeof createCostCommand> {
  return createCostCommand(runtime);
}

function createLogCommand(
  journalCommand: ReturnType<typeof createJournalCommand>,
  costCommand: ReturnType<typeof createCostCommand>,
) {
  return new Command()
    .description("Access system logs, activity journal and cost tracking")
    .command(ExaCtlCommandName.JOURNAL, journalCommand)
    .command(ExaCtlCommandName.COST, costCommand);
}

/** The log group over the shared journal command and a cost command. */
export function buildLogCommand(
  journalCommand: ReturnType<typeof createJournalCommand>,
  costCommand: ReturnType<typeof createCostCommand>,
): ReturnType<typeof createLogCommand> {
  return createLogCommand(journalCommand, costCommand);
}

function createLogsCommand(runtime: IExaCtlRuntime) {
  const { context } = runtime;
  return new Command()
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
}

export function buildLogsCommand(runtime: IExaCtlRuntime): ReturnType<typeof createLogsCommand> {
  return createLogsCommand(runtime);
}
