/**
 * @module CostCommands
 * @path apps/exactl/src/commands/cost_commands.ts
 * @description CLI command handler for LLM cost and token usage reporting.
 * @architectural-layer CLI
 * @related-files [packages/core/src/cost/cost_tracker.ts, apps/exactl/src/exactl.ts]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import * as colors from "@std/fmt/colors";
import { Table } from "@cliffy/table";
import { CostGroupBy, type ICostFilter, type ICostTracker } from "@exaix/core/types";
export interface ICostCommandOptions {
  traceId?: string;
  portal?: string;
  since?: string;
  model?: string;
  groupBy?: string;
}

/**
 * CostCommands provides CLI access to LLM cost and token usage reports.
 */
export class CostCommands extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  private get costTracker(): ICostTracker {
    return this.cost;
  }

  /**
   * Display aggregated cost reports
   */
  async show(options: ICostCommandOptions): Promise<void> {
    if (options.groupBy === CostGroupBy.ROLE) {
      throw new Error("Role cost grouping is not available in this build: generation calls have no role attribution.");
    }
    if (options.groupBy && options.groupBy !== CostGroupBy.MODEL && options.groupBy !== CostGroupBy.PORTAL) {
      throw new Error(`Invalid cost group: ${options.groupBy}. Use model or portal.`);
    }
    const sinceDate = options.since ? new Date(options.since) : undefined;
    if (options.since && Number.isNaN(sinceDate?.getTime())) {
      throw new Error("Invalid --since date. Use an ISO date.");
    }

    const criteria = {
      traceId: options.traceId,
      portal: options.portal,
      since: sinceDate,
      model: options.model,
    };

    if (options.groupBy) {
      await this.showGrouped(criteria, options.groupBy as CostGroupBy);
      return;
    }

    const records = await this.costTracker.queryByCriteria(criteria);

    if (records.length === 0) {
      console.log(colors.yellow("No cost records found matching the criteria."));
      return;
    }

    const table = new Table()
      .header([
        colors.bold("Timestamp"),
        colors.bold("Trace ID"),
        colors.bold("Portal"),
        colors.bold("Provider/Model"),
        colors.bold("Tokens (P/C/T)"),
        colors.bold("Cache (Read/Create)"),
        colors.bold("Cost (USD)"),
      ])
      .body(records.map((r) => [
        r.timestamp.toLocaleString(),
        r.traceId ? r.traceId.substring(0, 8) : "-",
        r.portal || "-",
        `${r.provider}/${r.model}`,
        `${r.promptTokens}/${r.completionTokens}/${r.tokens}`,
        `${r.cacheReadTokens ?? "-"}/${r.cacheCreationTokens ?? "-"}`,
        `$${r.estimatedCostUsd.toFixed(6)}`,
      ]));

    console.log(colors.cyan(colors.bold("\nLLM Cost & Token Usage Report")));
    console.log(colors.gray("=".repeat(80)));
    table.render();
    console.log(colors.gray("=".repeat(80)));

    const totalCost = records.reduce((acc, r) => acc + r.estimatedCostUsd, 0);
    const totalTokens = records.reduce((acc, r) => acc + r.tokens, 0);
    const totalPrompt = records.reduce((acc, r) => acc + r.promptTokens, 0);
    const totalCompletion = records.reduce((acc, r) => acc + r.completionTokens, 0);
    const totalCacheRead = records.reduce((acc, r) => acc + (r.cacheReadTokens ?? 0), 0);
    const totalCacheCreation = records.reduce((acc, r) => acc + (r.cacheCreationTokens ?? 0), 0);

    console.log(colors.bold(`Total Cost:    ${colors.green("$" + totalCost.toFixed(6))}`));
    console.log(colors.bold(`Total Tokens:  ${totalTokens} (Prompt: ${totalPrompt}, Completion: ${totalCompletion})`));
    if (totalCacheRead > 0 || totalCacheCreation > 0) {
      console.log(
        colors.bold(`Total Cache Tokens:  Read: ${totalCacheRead}, Creation: ${totalCacheCreation}`),
      );
    }
    console.log("");
  }

  private async showGrouped(criteria: ICostFilter, groupBy: CostGroupBy): Promise<void> {
    const tracker = this.costTracker;
    if (!tracker.queryGroupedByCriteria) {
      throw new Error("Grouped cost reporting is not available in this build.");
    }
    const groups = await tracker.queryGroupedByCriteria(criteria, groupBy);
    if (groups.length === 0) {
      console.log(colors.yellow("No cost records found matching the criteria."));
      return;
    }
    const table = new Table()
      .header(["Group", "Calls", "Prompt", "Completion", "Cache Read", "Cache Create", "Cost (USD)"])
      .body(groups.map((group) => [
        group.group,
        String(group.calls),
        String(group.promptTokens),
        String(group.completionTokens),
        String(group.cacheReadTokens),
        String(group.cacheCreationTokens),
        `$${group.estimatedCostUsd.toFixed(6)}`,
      ]));
    console.log(colors.cyan(colors.bold(`\nLLM Cost by ${groupBy}`)));
    table.render();
  }
}
