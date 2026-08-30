/**
 * @module JournalCommands
 * @path apps/exactl/src/commands/journal_commands.ts
 * @description Provides CLI access to the IActivity Journal, allowing users to query, filter, and display system activities and agent logs.
 * @architectural-layer CLI
 * @related-files ["packages/storage-sqlite/src/database_service.ts", "apps/daemon/main.ts"]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import * as colors from "@std/fmt/colors";
import type { IJournalFilterOptions } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import { JournalFormatter } from "@exaix/cli/formatters/journal_formatter.ts";
import type { UIOutputFormat } from "@exaix/tui";

export interface IJournalCommandOptions {
  filter?: string[];
  tail?: number;
  format?: UIOutputFormat;
  distinct?: string;
  count?: boolean;
  payload?: string;
  actor?: string;
  target?: string;
}

export interface IJournalWaitOptions {
  event?: string;
  /** ISO-datetime floor — only events timestamped after this count (user-facing). */
  since?: string;
  /** Internal rowid floor — only events with rowid strictly above this count. Used by the
   *  scenario framework (`$JOURNAL_BASELINE`); a rowid is collision-free where two events can
   *  share a millisecond timestamp. Takes precedence over `since` when both are set. */
  sinceRowid?: number;
  timeout?: number;
  payload?: string;
}

/** Default readiness-barrier timeout for `exactl journal wait` (seconds). */
const JOURNAL_WAIT_DEFAULT_TIMEOUT_SEC = 30;
/** Poll cadence for the readiness barrier — an event appearing after the baseline is noticed
 *  within one interval. */
const JOURNAL_WAIT_POLL_INTERVAL_MS = 500;

/**
 * JournalCommands provides CLI access to the IActivity Journal.
 */
export class JournalCommands extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  /**
   * Query and display journal activities
   */
  async show(options: IJournalCommandOptions): Promise<void> {
    const { db } = this;
    const filterOptions = this.parseFilterOptions(options);

    // Execute query
    const results = await db.queryActivity(filterOptions);

    // Format output
    JournalFormatter.render(results, filterOptions, options.format);
  }

  /**
   * Readiness barrier: blocks until `event` is journalled after `since` (default: the max rowid
   * at call time, so only events appearing while waiting count). Exits 0 on match, 1 on timeout.
   */
  async wait(options: IJournalWaitOptions): Promise<void> {
    const event = options.event;
    const timeoutSec = options.timeout ?? JOURNAL_WAIT_DEFAULT_TIMEOUT_SEC;
    const payload = options.payload;
    if (!event) {
      console.error(colors.red("journal wait requires --event <action_type>"));
      Deno.exit(1);
    }
    // Baseline: `--since-rowid` (internal) wins over `--since` (timestamp); with neither, the
    // current max rowid at call time — so only events that arrive while waiting count.
    const baseline = options.sinceRowid !== undefined
      ? { rowid: options.sinceRowid }
      : options.since
      ? { iso: options.since }
      : { rowid: await this.currentMaxRowid() };
    const timeoutMs = timeoutSec * 1000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (await this.journalHasEvent(event, baseline, payload)) {
        console.log(`Journal event present: ${event}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, JOURNAL_WAIT_POLL_INTERVAL_MS));
    }

    console.error(colors.red(`Timeout after ${timeoutSec}s waiting for journal event: ${event}`));
    Deno.exit(1);
  }

  /** True when an activity row matches `event` above the rowid/timestamp baseline. */
  private async journalHasEvent(
    event: string,
    baseline: { rowid?: number; iso?: string },
    payload: Opt<string, Reason.OptionalInput> = undefined,
  ): Promise<boolean> {
    let where = "action_type = ?";
    const params: Array<string | number> = [event];
    if (baseline.rowid !== undefined) {
      where += " AND rowid > ?";
      params.push(baseline.rowid);
    } else if (baseline.iso) {
      where += " AND timestamp > ?";
      params.push(baseline.iso);
    }
    if (payload) {
      where += " AND payload LIKE ?";
      params.push(payload);
    }
    const row = await this.db.preparedGet<{ n: number }>(
      `SELECT 1 AS n FROM activity WHERE ${where} LIMIT 1`,
      params,
    );
    // `preparedGet` yields undefined (not null) for an absent row — treat both as no-match.
    return row !== null && row !== undefined;
  }

  /** The highest activity rowid currently journalled, or 0 in an empty journal. */
  private async currentMaxRowid(): Promise<number> {
    const row = await this.db.preparedGet<{ m: number }>("SELECT MAX(rowid) AS m FROM activity");
    return row?.m ?? 0;
  }

  private parseFilterOptions(options: IJournalCommandOptions): IJournalFilterOptions {
    const filterOptions: IJournalFilterOptions = {};

    if (options.tail) {
      filterOptions.limit = options.tail;
    }

    if (options.distinct) {
      filterOptions.distinct = options.distinct;
    }

    if (options.count) {
      filterOptions.count = true;
    }

    if (options.payload) {
      filterOptions.payload = options.payload;
    }

    if (options.actor) {
      filterOptions.actor = options.actor;
    }

    if (options.target) {
      filterOptions.target = options.target;
    }

    if (options.filter) {
      // Normalize filter to always be an array (Cliffy sometimes returns string for single value)
      const filters = Array.isArray(options.filter) ? options.filter : [options.filter];

      const applyFilterValue: Record<string, (value: string) => void> = {
        trace_id: (value) => {
          filterOptions.traceId = value;
        },
        action_type: (value) => {
          filterOptions.actionType = value;
        },
        identity_id: (value) => {
          filterOptions.identityId = value;
        },
        time: (value) => {
          filterOptions.since = value;
        },
        since: (value) => {
          filterOptions.since = value;
        },
        payload: (value) => {
          filterOptions.payload = value;
        },
        actor: (value) => {
          filterOptions.actor = value;
        },
        target: (value) => {
          filterOptions.target = value;
        },
      };

      for (const filter of filters) {
        // Ensure filter is a string
        const filterStr = typeof filter === "string" ? filter : String(filter);
        const [key, value] = filterStr.split("=");
        if (!key || !value) {
          console.error(colors.red(`Invalid filter format: ${filterStr}. Use key=value.`));
          Deno.exit(1);
        }

        const apply = applyFilterValue[key];
        if (!apply) {
          console.error(
            colors.yellow(
              `Unknown filter key: ${key}. Supported: trace_id, action_type, identity_id, since, payload, actor, target.`,
            ),
          );
          continue;
        }

        apply(value);
      }
    }
    return filterOptions;
  }
}

/** Converts bare event names (e.g., `model_resolved`) to `action_type=<name>`
 *  for the `exactl logs` command. Passes through existing `key=value` pairs.
 */
export function normalizeLogsFilter(filters: string[]): string[] {
  return filters.map((f) => f.includes("=") ? f : `action_type=${f}`);
}
