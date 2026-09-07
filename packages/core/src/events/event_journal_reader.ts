/**
 * @module EventJournalReader
 * @path packages/core/src/events/event_journal_reader.ts
 * @architectural-layer Core
 * @dependencies ["@exaix/storage-sqlite", "@exaix/core/types"]
 * @related-files ["exaix-team/packages/mcp-server/domain_tools.ts", "packages/core/src/artifact/mission_reporter.ts"]
 * @description Read-only interface for querying the activity journal.
 * Encapsulates IDatabaseService behind a focused read contract so that
 * consumers like QueryJournalTool and MissionReporter do not depend on
 * the full database service.
 */

import type { ActivityRecord } from "@exaix/storage-sqlite";
import type { IJournalFilterOptions } from "../types/database.ts";

export interface IEventJournalReader {
  getActivitiesByTrace(traceId: string): ActivityRecord[];
  getActivitiesByTraceSafe(traceId: string): Promise<ActivityRecord[]>;
  getRecentActivity(limit?: number): Promise<ActivityRecord[]>;
  queryActivity(filter: IJournalFilterOptions): Promise<ActivityRecord[]>;
}
