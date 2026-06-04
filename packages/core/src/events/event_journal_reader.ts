/**
 * @module EventJournalReader
 * @path packages/core/src/events/event_journal_reader.ts
 * @architectural-layer Core
 * @dependencies ["@exaix/storage-sqlite"]
 * @related-files ["packages/mcp/server/domain_tools.ts"]
 * @description Read-only interface for querying the activity journal.
 * Encapsulates IDatabaseService behind a focused read contract so that
 * consumers like QueryJournalTool do not depend on the full database service.
 */

import type { ActivityRecord } from "@exaix/storage-sqlite";

export interface IEventJournalReader {
  getActivitiesByTrace(traceId: string): ActivityRecord[];
  getActivitiesByTraceSafe(traceId: string): Promise<ActivityRecord[]>;
  getRecentActivity(limit?: number): Promise<ActivityRecord[]>;
}
