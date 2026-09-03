/**
 * @module ArchiveCommands
 * @path apps/exactl/src/commands/archive_commands.ts
 * @description Provides CLI commands for interacting with the execution archive, including listing, showing details, and searching by date or agent.
 * @architectural-layer CLI
 * @related-files [@exaix/core/artifact, "apps/daemon/main.ts"]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";

export class ArchiveCommands extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  async list(): Promise<void> {
    const index = await this.archive.searchByDateRange("0000-01-01T00:00:00Z", "9999-12-31T23:59:59Z");
    for (const entry of index) {
      console.log(`${entry.archived_at} | ${entry.trace_id} | ${entry.agent_role} | ${entry.status}`);
    }
  }

  async show(traceId: string): Promise<void> {
    const entry = await this.archive.getByTraceId(traceId);
    if (!entry) {
      console.error(`No archive entry found for trace_id: ${traceId}`);
      return;
    }
    console.log(JSON.stringify(entry, null, 2));
  }

  async search(query: string): Promise<void> {
    // For demo: search by agent_role
    const results = await this.archive.searchByAgent(query);
    for (const entry of results) {
      console.log(`${entry.archived_at} | ${entry.trace_id} | ${entry.agent_role} | ${entry.status}`);
    }
  }

  async stats(): Promise<void> {
    const index = await this.archive.searchByDateRange("0000-01-01T00:00:00Z", "9999-12-31T23:59:59Z");
    const total = index.length;
    const byStatus = index.reduce((acc, e) => {
      acc[e.status] = (acc[e.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log(`Total: ${total}`);
    for (const [status, count] of Object.entries(byStatus)) {
      console.log(`${status}: ${count}`);
    }
  }
}
