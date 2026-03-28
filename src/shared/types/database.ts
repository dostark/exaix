/**
 * @module Database
 * @path src/shared/types/database.ts
 * @description Module for Database.
 * @architectural-layer Shared
 * @dependencies [Enums]
 * @related-files [src/services/db.ts]
 */

/**
 * Filter options for querying activity journal.
 */
export interface IJournalFilterOptions {
  traceId?: string;
  actionType?: string;
  identityId?: string;
  limit?: number;
  since?: string; // ISO date string
  payload?: string; // LIKE pattern
  actor?: string;
  target?: string;
  distinct?: string; // field name for DISTINCT
  count?: boolean; // if true, return count aggregation
  orConditions?: IJournalFilterOptions[]; // OR conditions
}

/**
 * Activity record returned from database queries.
 */
export interface IActivityRecord {
  id: string;
  trace_id: string;
  actor: string | null;
  actor_type: string | null;
  identity_id: string | null;
  agent_kind?: string | null;
  action_type: string;
  target: string | null;
  payload: string;
  timestamp: string;
  count?: number;
}

/**
 * Supported parameter types for SQLite queries.
 */
export type SqliteParam = string | number | boolean | null | Uint8Array;
