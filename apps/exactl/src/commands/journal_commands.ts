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
  since?: number;
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
   * Readiness barrier: block until `event` is journalled ABOVE `since` (default: the current
   * max rowid at call time — the barrier only counts events that appear while waiting), or the
   * timeout elapses. Exits 0 with `Journal event present: <event>` on a match, 1 with a timeout
   * message otherwise. The `since` baseline (rowid) lets a caller ignore a stale event a prior
   * run produced — scenario steps pass the scenario's journal baseline so a `daemon.ready` that
   * fired before this barrier started still counts.
   */
  async wait(options: IJournalWaitOptions): Promise<void> {
    const event = options.event;
    const timeoutSec = options.timeout ?? JOURNAL_WAIT_DEFAULT_TIMEOUT_SEC;
    const payload = options.payload;
    if (!event) {
      console.error(colors.red("journal wait requires --event <action_type>"));
      Deno.exit(1);
    }
    const sinceRowid = options.since ?? await this.currentMaxRowid();
    const timeoutMs = timeoutSec * 1000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (await this.journalHasEvent(event, sinceRowid, payload)) {
        console.log(`Journal event present: ${event}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, JOURNAL_WAIT_POLL_INTERVAL_MS));
    }

    console.error(colors.red(`Timeout after ${timeoutSec}s waiting for journal event: ${event}`));
    Deno.exit(1);
  }

  /** True when an activity row matches `event` with rowid strictly above `sinceRowid`. */
  private async journalHasEvent(
    event: string,
    sinceRowid: number,
    payload: Opt<string, Reason.OptionalInput> = undefined,
  ): Promise<boolean> {
    const params: Array<string | number> = payload ? [event, sinceRowid, payload] : [event, sinceRowid];
    const where = payload ? " AND payload LIKE ?" : "";
    const row = await this.db.preparedGet<{ n: number }>(
      `SELECT 1 AS n FROM activity WHERE action_type = ? AND rowid > ?${where} LIMIT 1`,
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
