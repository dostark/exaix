/**
 * @module ExaCtlLogCommand
 * @path apps/exactl/src/command_builders/log_command.ts
 * @description Builds the exactl log command over the activity journal and the cost report.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/commands/journal_commands.ts]
 */

import { Command } from "@cliffy/command";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import type { IActivityRecord } from "@exaix/core/types";
import { ExaCtlOutputFormat, type IExaCtlColumn } from "@exaix/cli";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import {
  type IJournalCommandOptions,
  type IJournalWaitOptions,
  JournalCommands,
  normalizeLogsFilter,
} from "../commands/journal_commands.ts";
import { CostCommands, costShares, costTotals, formatCost, recordCostSource } from "../commands/cost_commands.ts";
import { CLI_OPTION_MODEL, CLI_OPTION_PORTAL_LONG, ExaCtlCommandName, ExaCtlVerb } from "../exactl_constants.ts";
import {
  actionOutput,
  cellText,
  ColumnHeader,
  EMPTY_CELL,
  type IJsonRow,
  toRow,
  TRACE_PREFIX_CHARS,
} from "../output/exactl_output.ts";
import { documentLeaves } from "./documented_children.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";

const TARGET_MAX_CHARS = 30;
const SOURCE_SEPARATOR = ", ";
const LOG_LIMIT_DEFAULT = 50;

const ACTIVITY_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Timestamp", value: (row) => cellText(row.timestamp) },
  { header: ColumnHeader.ACTION, value: (row) => cellText(row.action_type) },
  { header: ColumnHeader.AGENT, value: (row) => cellText(row.agent_role ?? row.actor) },
  { header: ColumnHeader.TRACE, value: (row) => cellText(row.trace_id).slice(0, TRACE_PREFIX_CHARS) },
  { header: "Target", value: (row) => cellText(row.target).slice(0, TARGET_MAX_CHARS) },
  {
    header: "Cost",
    value: (row) => typeof row.cost_usd === "number" && row.cost_usd > 0 ? formatCost(row.cost_usd) : EMPTY_CELL,
  },
];

const COUNT_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Action Type", value: (row) => cellText(row.action_type) },
  { header: "Count", value: (row) => String(row.count ?? 0) },
];

const RECORD_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Timestamp", value: (row) => cellText(row.timestamp) },
  { header: ColumnHeader.TRACE, value: (row) => cellText(row.trace_id).slice(0, TRACE_PREFIX_CHARS) },
  { header: ColumnHeader.PORTAL, value: (row) => cellText(row.portal) },
  { header: "Provider/Model", value: (row) => `${cellText(row.provider)}/${cellText(row.model)}` },
  { header: "Service", value: (row) => cellText(row.service) },
  { header: "Tokens (P/C/T)", value: (row) => `${row.prompt_tokens}/${row.completion_tokens}/${row.tokens}` },
  {
    header: "Cache (Read/Create)",
    value: (row) => `${row.cache_read_tokens ?? "-"}/${row.cache_creation_tokens ?? "-"}`,
  },
  { header: "Cost (USD)", value: (row) => formatCost(row.estimated_cost_usd as number | null) },
  { header: "Source", value: (row) => cellText(row.cost_source) },
];

const GROUP_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Group", value: (row) => cellText(row.group) },
  { header: "Calls", value: (row) => String(row.calls) },
  { header: "Prompt", value: (row) => String(row.promptTokens) },
  { header: "Completion", value: (row) => String(row.completionTokens) },
  { header: "Cache Read", value: (row) => String(row.cacheReadTokens) },
  { header: "Cache Create", value: (row) => String(row.cacheCreationTokens) },
  { header: "Cost (USD)", value: (row) => formatCost(row.estimatedCostUsd as number | null) },
  { header: "Unpriced", value: (row) => String(row.unpricedCalls) },
  {
    header: "Share by source",
    value: (row) => {
      const shares = row.share_by_source;
      if (shares === null || typeof shares !== "object" || Array.isArray(shares)) return EMPTY_CELL;
      return Object.entries(shares).map(([source, share]) => `${source} ${share}%`).join(SOURCE_SEPARATOR);
    },
  },
];

const VERIFY_FIELDS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "OK", value: (row) => String(row.ok) },
  { header: "Rows checked", value: (row) => String(row.rows_checked) },
  { header: "Unverifiable prefix", value: (row) => String(row.unhashed_prefix) },
  { header: "First broken row", value: (row) => cellText(row.first_broken_id) },
];

function activityColumns(options: IJournalCommandOptions): readonly IExaCtlColumn<IJsonRow>[] {
  if (options.distinct) {
    return [{ header: options.distinct, value: (row) => cellText(row[options.distinct as string]) }];
  }
  return options.count ? COUNT_COLUMNS : ACTIVITY_COLUMNS;
}

function createListCommand(runtime: IExaCtlRuntime) {
  const { context } = runtime;
  return new Command()
    .option(
      "--filter <filter:string>",
      "Filter by key=value (trace_id, action_type, agent_role, since) or a bare event name",
      { collect: true },
    )
    .option("-n, --limit <n:number>", "Show last N entries", { default: LOG_LIMIT_DEFAULT })
    .option("--distinct <field:string>", "Return distinct values for specified field")
    .option("--count", "Return count aggregation by action_type")
    .option("--payload <pattern:string>", "Filter by payload LIKE pattern")
    .option("--actor <actor:string>", "Filter by actor")
    .option("--target <target:string>", "Filter by target")
    .action(async (options) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
      const journalOptions: IJournalCommandOptions = {
        ...options,
        filter: options.filter ? normalizeLogsFilter(options.filter) : undefined,
      };
      const { rows } = await new JournalCommands(context).query(journalOptions);
      await renderer.list(
        rows.map((row: IActivityRecord) => toRow(row)),
        activityColumns(journalOptions),
        (row) => cellText(row.id ?? row.action_type),
      );
    });
}

function createWaitCommand(runtime: IExaCtlRuntime) {
  const { context } = runtime;
  return new Command()
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
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
      const matched = await new JournalCommands(context).wait(options as IJournalWaitOptions);
      if (renderer.machine) await renderer.event({ type: "journal.event", action_type: matched });
      else await renderer.text(`Journal event present: ${matched}`);
    });
}

function createVerifyCommand(runtime: IExaCtlRuntime) {
  const { context } = runtime;
  return new Command().action(async (options) => {
    const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
    const report = await new JournalCommands(context).verify();
    await renderer.item(toRow(report), VERIFY_FIELDS);
    if (!report.ok) {
      throw new ExaCtlError(ExaCtlExitCode.INVALID, `Journal integrity FAILED at row ${report.first_broken_id}`);
    }
  });
}

function createCostCommand(runtime: IExaCtlRuntime) {
  const { context } = runtime;
  return new Command()
    .option("--trace <id:string>", "Filter by trace ID")
    .option(CLI_OPTION_PORTAL_LONG, "Filter by portal alias")
    .option("--since <date:string>", "Filter by date (ISO string)")
    .option(CLI_OPTION_MODEL, "Filter by model")
    .option("--group-by <dimension:string>", "Group costs by model, portal or service")
    .action(async (options) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
      const report = await new CostCommands(context).report(options);
      if (report.groups !== undefined) {
        const rows = report.groups.map((group) =>
          toRow({ ...group, cost_by_source: group.costBySource, share_by_source: costShares(group) })
        );
        await renderer.list(rows, GROUP_COLUMNS, (row) => cellText(row.group));
        return;
      }
      const rows = report.records.map((record) =>
        toRow({
          timestamp: record.timestamp.toISOString(),
          trace_id: record.traceId ?? null,
          portal: record.portal ?? null,
          provider: record.provider,
          model: record.model,
          service: record.service ?? null,
          transport: record.transport ?? null,
          prompt_tokens: record.promptTokens,
          completion_tokens: record.completionTokens,
          tokens: record.tokens,
          cache_read_tokens: record.cacheReadTokens ?? null,
          cache_creation_tokens: record.cacheCreationTokens ?? null,
          estimated_cost_usd: record.estimatedCostUsd,
          cost_source: recordCostSource(record),
        })
      );
      await renderer.list(rows, RECORD_COLUMNS, (row) => cellText(row.trace_id));
      if (!renderer.machine && report.records.length > 0) {
        for (const line of costTotals(report.records)) await renderer.text(line);
      }
    });
}

function createLogCommand(runtime: IExaCtlRuntime) {
  const noun = nounDocFor(ExaCtlCommandName.LOG);
  const command = documentedNoun(new Command(), noun)
    .command(ExaCtlVerb.LIST, createListCommand(runtime))
    .command(ExaCtlVerb.WAIT, createWaitCommand(runtime))
    .command(ExaCtlVerb.VERIFY, createVerifyCommand(runtime))
    .command(ExaCtlVerb.COST, createCostCommand(runtime));
  documentLeaves(command, [ExaCtlCommandName.LOG], noun.lifecycle);
  return command;
}

export function buildLogCommand(runtime: IExaCtlRuntime): ReturnType<typeof createLogCommand> {
  return createLogCommand(runtime);
}
