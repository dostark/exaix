/**
 * @module ExaCtlLogCommand
 * @path apps/exactl/src/command_builders/log_command.ts
 * @description Builds the exactl log command over the activity journal and the cost report.
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
import { CLI_OPTION_MODEL, CLI_OPTION_PORTAL, CLI_OUTPUT_FORMAT_OPTION, ExaCtlVerb } from "../exactl_constants.ts";

function createListCommand(runtime: IExaCtlRuntime) {
  const { context } = runtime;
  return new Command()
    .description("Query the activity journal")
    .option(
      "-f, --filter <filter:string>",
      "Filter by key=value (trace_id, action_type, agent_role, since) or a bare event name",
      { collect: true },
    )
    .option("-n, --tail <n:number>", "Show last N entries", { default: 50 })
    .option(CLI_OUTPUT_FORMAT_OPTION, "Output format (text, table, json)", { default: CLI_OUTPUT_FORMATS.TEXT })
    .option("--distinct <field:string>", "Return distinct values for specified field")
    .option("--count", "Return count aggregation by action_type")
    .option("--payload <pattern:string>", "Filter by payload LIKE pattern")
    .option("--actor <actor:string>", "Filter by actor")
    .option("--target <target:string>", "Filter by target")
    .action(async (options) => {
      if (options.filter) {
        options.filter = normalizeLogsFilter(options.filter);
      }
      await new JournalCommands(context).show(options as IJournalCommandOptions);
    });
}

function createWaitCommand(runtime: IExaCtlRuntime) {
  const { context } = runtime;
  return new Command()
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
      await new JournalCommands(context).wait(options as IJournalWaitOptions);
    });
}

function createVerifyCommand(runtime: IExaCtlRuntime) {
  const { context } = runtime;
  return new Command()
    .description("Verify the activity hash chain (exit 1 when tampered)")
    .action(async () => {
      const code = await new JournalCommands(context).verify();
      if (code !== 0) Deno.exit(code);
    });
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
      await new CostCommands(context).show(options);
    });
}

function createLogCommand(runtime: IExaCtlRuntime) {
  return new Command()
    .description("Access the activity journal and cost tracking")
    .command(ExaCtlVerb.LIST, createListCommand(runtime))
    .command(ExaCtlVerb.WAIT, createWaitCommand(runtime))
    .command(ExaCtlVerb.VERIFY, createVerifyCommand(runtime))
    .command(ExaCtlVerb.COST, createCostCommand(runtime));
}

export function buildLogCommand(runtime: IExaCtlRuntime): ReturnType<typeof createLogCommand> {
  return createLogCommand(runtime);
}
