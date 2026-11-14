/**
 * @module JournalCommands
 * @path apps/exactl/src/commands/journal_commands.ts
 * @description Provides CLI access to the IActivity Journal, allowing users to query, filter, and display system activities and agent logs.
 * @architectural-layer CLI
 * @related-files ["packages/storage-sqlite/src/database_service.ts", "apps/daemon/main.ts"]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import * as colors from "@std/fmt/colors";
import type { IActivityRecord, IJournalFilterOptions } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import { DomainEventType, type IJournalIntegrityPayload } from "@exaix/core/events";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";

export interface IJournalCommandOptions {
  filter?: string[];
  limit?: number;
  distinct?: string;
  count?: boolean;
  payload?: string;
  actor?: string;
  target?: string;
}

/** The outcome of an activity hash chain check. */
export interface IJournalVerifyReport extends IJournalIntegrityPayload {
  ok: boolean;
}

export interface IJournalWaitOptions {
  /** One event, or several to wait on with OR semantics — resolves on whichever appears first. */
  event?: string | string[];
  /** ISO-datetime floor — only events timestamped after this count (user-facing). */
  since?: string;
  /** Internal rowid floor — only events with rowid strictly above this count. Used by the
   *  scenario framework (`$JOURNAL_BASELINE`); a rowid is collision-free where two events can
   *  share a millisecond timestamp. Takes precedence over `since` when both are set. */
  sinceRowid?: number;
  timeout?: number;
  payload?: string;
}

/** Actor recorded on journal-integrity events emitted by `exactl log verify`. */
const JOURNAL_VERIFY_ACTOR = "exactl-journal-verify";

/** Default readiness-barrier timeout for `exactl log wait` (seconds). */
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

  /** The journal rows that match the options, with the filter the query used. */
  async query(options: IJournalCommandOptions): Promise<{ rows: IActivityRecord[]; filter: IJournalFilterOptions }> {
    const filter = this.parseFilterOptions(options);
    return { rows: await this.db.queryActivity(filter), filter };
  }

  /** Verifies the activity hash chain and journals the outcome. Rows from before the chain existed are an unverifiable prefix. */
  async verify(): Promise<IJournalVerifyReport> {
    const report = await this.db.verifyJournalIntegrity();
    const traceId = crypto.randomUUID();
    const payload: IJournalIntegrityPayload = {
      rows_checked: report.rows_checked,
      unhashed_prefix: report.unhashed_prefix,
      first_broken_id: report.first_broken_id,
      expected_hash: report.expected_hash,
      actual_hash: report.actual_hash,
    };
    await this.logger.info(
      report.ok ? DomainEventType.JournalIntegrityVerified : DomainEventType.JournalIntegrityFailed,
      JOURNAL_VERIFY_ACTOR,
      { ...payload },
      traceId,
    );
    return { ok: report.ok, ...payload };
  }

  /** Readiness barrier: blocks until `event` is journalled after `since` (default: the max
   *  rowid at call time). Returns the matched event, and fails on a missing event or on timeout. */
  async wait(options: IJournalWaitOptions): Promise<string> {
    const events = this.normalizeEvents(options.event);
    const timeoutSec = options.timeout ?? JOURNAL_WAIT_DEFAULT_TIMEOUT_SEC;
    const payload = options.payload;
    if (events.length === 0) {
      throw new ExaCtlError(ExaCtlExitCode.USAGE, "log wait requires --event <action_type>");
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
      const matched = await this.journalHasEvent(events, baseline, payload);
      if (matched) return matched;
      await new Promise((resolve) => setTimeout(resolve, JOURNAL_WAIT_POLL_INTERVAL_MS));
    }

    throw new ExaCtlError(
      ExaCtlExitCode.FAILURE,
      `Timeout after ${timeoutSec}s waiting for journal event: ${events.join(", ")}`,
    );
  }

  /** Normalizes the `--event` option (single value, repeated values, or absent) into a list. */
  private normalizeEvents(event: IJournalWaitOptions["event"]): string[] {
    if (!event) return [];
    return Array.isArray(event) ? event : [event];
  }

  /** Returns the first of `events` (OR semantics) with an activity row above the rowid/timestamp
   *  baseline, or undefined when none match. */
  private async journalHasEvent(
    events: string[],
    baseline: { rowid?: number; iso?: string },
    payload: Opt<string, Reason.OptionalInput> = undefined,
  ): Promise<string | undefined> {
    let where = `action_type IN (${events.map(() => "?").join(", ")})`;
    const params: Array<string | number> = [...events];
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
    const row = await this.db.preparedGet<{ action_type: string }>(
      `SELECT action_type FROM activity WHERE ${where} ORDER BY rowid ASC LIMIT 1`,
      params,
    );
    // `preparedGet` yields undefined (not null) for an absent row — treat both as no-match.
    return row === null || row === undefined ? undefined : row.action_type;
  }

  /** The highest activity rowid currently journalled, or 0 in an empty journal. */
  private async currentMaxRowid(): Promise<number> {
    const row = await this.db.preparedGet<{ m: number }>("SELECT MAX(rowid) AS m FROM activity");
    return row?.m ?? 0;
  }

  private parseFilterOptions(options: IJournalCommandOptions): IJournalFilterOptions {
    const filterOptions: IJournalFilterOptions = {};

    if (options.limit) {
      filterOptions.limit = options.limit;
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
        agent_role: (value) => {
          filterOptions.agentRole = value;
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
              `Unknown filter key: ${key}. Supported: trace_id, action_type, agent_role, since, payload, actor, target.`,
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
 *  for the `exactl log list` command. Passes through existing `key=value` pairs.
 */
export function normalizeLogsFilter(filters: string[]): string[] {
  return filters.map((f) => f.includes("=") ? f : `action_type=${f}`);
}
