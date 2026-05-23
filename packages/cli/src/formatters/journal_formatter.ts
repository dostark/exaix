/**
 * @module JournalFormatter
 * @path packages/cli/src/formatters/journal_formatter.ts
 * @related-files []
 * @description Provides formatting and rendering logic for IActivity Journal records in the CLI, supporting table, text, and JSON outputs.
 * @architectural-layer CLI
 * @ungrounded
 */

import { Table } from "@cliffy/table";
import * as colors from "@std/fmt/colors";
import type { IActivityRecord } from "@exaix/core/types";
import type { IJournalFilterOptions } from "@exaix/core/types";
import { DataFormat } from "@exaix/core";
import { UIOutputFormat } from "@exaix/tui";

const ERR_KEYWORD = "error";
const COST_PRECISION = 6;

export class JournalFormatter {
  static render(
    activities: IActivityRecord[],
    filter: IJournalFilterOptions,
    format: UIOutputFormat | DataFormat.TEXT = DataFormat.TEXT,
  ): void {
    if (format === UIOutputFormat.JSON) {
      console.log(JSON.stringify(activities, null, 2));
      return;
    }

    if (activities.length === 0) {
      console.log(colors.gray("No activities found."));
      return;
    }

    if (format === UIOutputFormat.TABLE) {
      this.renderTable(activities, filter);
    } else {
      this.renderText(activities, filter);
    }
  }

  private static renderTable(activities: IActivityRecord[], filter: IJournalFilterOptions): void {
    if (filter.distinct) {
      const table = new Table()
        .header([colors.bold(filter.distinct)])
        .body(
          activities.map((a) => [String(a[filter.distinct as keyof IActivityRecord] || "")]),
        );
      table.render();
      return;
    }

    if (filter.count) {
      const table = new Table()
        .header([
          colors.bold("Action Type"),
          colors.bold("Count"),
        ])
        .body(
          activities.map((a) => [
            a.action_type,
            String(a.count || 0),
          ]),
        );
      table.render();
      return;
    }

    const table = new Table()
      .header([
        colors.bold("Timestamp"),
        colors.bold("Action"),
        colors.bold("Agent"),
        colors.bold("Trace ID"),
        colors.bold("Target"),
        colors.bold("Cost"),
      ])
      .body(
        activities.map((a) => {
          const timestamp = new Date(a.timestamp).toLocaleString();
          const action = this.styleAction(a.action_type);

          return [
            colors.gray(timestamp),
            action,
            a.identity_id || a.actor || "-",
            colors.gray(a.trace_id.slice(0, 8)),
            this.truncateText(a.target || "-", 30),
            this.formatCostDisplay(a.cost_usd, a.payload),
          ];
        }),
      )
      .border(true);

    table.render();
  }

  private static renderText(activities: IActivityRecord[], filter: IJournalFilterOptions): void {
    if (filter.distinct) {
      this.renderDistinctText(activities, filter.distinct);
      return;
    }

    if (filter.count) {
      this.renderCountText(activities);
      return;
    }

    for (const activity of activities) {
      const timestamp = new Date(activity.timestamp).toLocaleString();
      const traceId = activity.trace_id.slice(0, 8);
      const agent = activity.identity_id || activity.actor || "-";

      const action = this.styleAction(activity.action_type);
      const costText = this.formatCostDisplay(activity.cost_usd, activity.payload);
      const costSuffix = costText === "-" ? "" : ` ${colors.dim("cost=")}${colors.yellow(costText)}`;

      const tokens = (activity.prompt_tokens || 0) + (activity.completion_tokens || 0);
      const tokenSuffix = tokens > 0 ? ` ${colors.dim("tokens=")}${colors.cyan(String(tokens))}` : "";

      console.log(
        `${colors.gray(timestamp)} ${action} ${colors.dim("agent=")}${agent} ${colors.dim("trace=")}${
          colors.gray(traceId)
        } ${colors.dim("target=")}${activity.target || "-"}${costSuffix}${tokenSuffix}`,
      );
    }
  }

  private static formatCostDisplay(costUsd: number | undefined, payload: string): string {
    if (typeof costUsd === "number" && costUsd > 0) {
      return `$${costUsd.toFixed(COST_PRECISION)}`;
    }

    try {
      const parsed = JSON.parse(payload) as {
        usage?: { cost_usd_estimate?: number };
        cost_usd_estimate?: number;
      };

      const rawCost = parsed.usage?.cost_usd_estimate ?? parsed.cost_usd_estimate;
      if (typeof rawCost !== "number" || Number.isNaN(rawCost) || rawCost <= 0) {
        return "-";
      }

      return `$${rawCost.toFixed(COST_PRECISION)}`;
    } catch {
      return "-";
    }
  }

  private static renderDistinctText(activities: IActivityRecord[], distinctField: string): void {
    for (const activity of activities) {
      const value = activity[distinctField as keyof IActivityRecord] || "";
      console.log(value);
    }
  }

  private static renderCountText(activities: IActivityRecord[]): void {
    for (const activity of activities) {
      console.log(`${activity.action_type}: ${activity.count || 0}`);
    }
  }

  private static styleAction(action: string): string {
    if (action.includes(ERR_KEYWORD) || action.includes("fail") || action.includes("reject")) {
      return colors.red(action);
    }
    if (action.includes("approve") || action.includes("success")) {
      return colors.green(action);
    }
    if (action.includes("create") || action.includes("start")) {
      return colors.blue(action);
    }
    return action;
  }

  private static truncateText(str: string, max: number): string {
    return str.length > max ? str.slice(0, max - 3) + "..." : str;
  }
}
