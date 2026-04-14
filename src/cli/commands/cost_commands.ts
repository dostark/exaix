/**
 * @module CostCommands
 * @path src/cli/commands/cost_commands.ts
 * @description CLI command handler for LLM cost and token usage reporting.
 * @architectural-layer CLI
 * @related-files [src/services/cost/cost_tracker.ts, src/cli/exactl.ts]
 */

import { BaseCommand, type ICommandContext } from "../base.ts";
import * as colors from "@std/fmt/colors";
import { Table } from "@cliffy/table";
import type { ICostTracker } from "../../shared/interfaces/i_cost_tracker.ts";

export interface ICostCommandOptions {
  traceId?: string;
  portal?: string;
  since?: string;
  model?: string;
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
    const sinceDate = options.since ? new Date(options.since) : undefined;

    const records = await this.costTracker.queryByCriteria({
      traceId: options.traceId,
      portal: options.portal,
      since: sinceDate,
      model: options.model,
    });

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
        colors.bold("Cost (USD)"),
      ])
      .body(records.map((r) => [
        r.timestamp.toLocaleString(),
        r.traceId ? r.traceId.substring(0, 8) : "-",
        r.portal || "-",
        `${r.provider}/${r.model}`,
        `${r.promptTokens}/${r.completionTokens}/${r.tokens}`,
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

    console.log(colors.bold(`Total Cost:    ${colors.green("$" + totalCost.toFixed(6))}`));
    console.log(colors.bold(`Total Tokens:  ${totalTokens} (Prompt: ${totalPrompt}, Completion: ${totalCompletion})`));
    console.log("");
  }
}
