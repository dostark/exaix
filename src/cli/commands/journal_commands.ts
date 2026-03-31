/**
 * @module JournalCommands
 * @path src/cli/commands/journal_commands.ts
 * @description Provides CLI access to the IActivity Journal, allowing users to query, filter, and display system activities and agent logs.
 * @architectural-layer CLI
 * * @related-files [src/services/db.ts, src/cli/main.ts]
 */

import { BaseCommand, type ICommandContext } from "../base.ts";
import * as colors from "@std/fmt/colors";
import { IJournalFilterOptions } from "../../shared/types/database.ts";
import { JournalFormatter } from "../formatters/journal_formatter.ts";
import { UIOutputFormat } from "../../shared/enums.ts";

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
