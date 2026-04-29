/**
 * @module IdatabaseService
 * @path packages/core/src/types/i_database_service.ts
 * @description Module for IdatabaseService.
 * @architectural-layer Shared
 * @related-files [@exaix/core/types/database.ts]
 */

import type { JSONValue } from "@exaix/core";
import type { IActivityRecord, IJournalFilterOptions, SqliteParam } from "@exaix/core/types/database.ts";

export interface IDatabaseService {
  /**
   * Log an activity to the journal (non-blocking, batched writes).
   */
  logActivity(
    actor: string,
    actionType: string,
    target: string | null,
    payload: Record<string, JSONValue>,
    traceId?: string,
    actorType?: string | null,
    identityId?: string | null,
    agentKind?: string | null,
    promptTokens?: number,
    completionTokens?: number,
    costUsd?: number,
  ): void;

  /**
   * Wait for all pending log entries to be flushed to disk.
   */
  waitForFlush(): Promise<void>;

  /**
   * Query activities based on filters.
   */
  queryActivity(filter: IJournalFilterOptions): Promise<IActivityRecord[]>;

  /**
   * Close the database connection.
   */
  close(): Promise<void>;

  /**
   * Execute a query that returns a single object or null.
   */
  preparedGet<T>(query: string, params?: SqliteParam[]): Promise<T | null>;

  /**
   * Execute a query that returns an array of objects.
   */
  preparedAll<T>(query: string, params?: SqliteParam[]): Promise<T[]>;

  /**
   * Execute a non-query statement (INSERT/UPDATE/DELETE).
   */
  preparedRun(query: string, params?: SqliteParam[]): Promise<unknown>;

  /**
   * Get activities by trace ID.
   */
  getActivitiesByTrace(traceId: string): IActivityRecord[];

  /**
   * Get activities by trace ID (async/safe version).
   */
  getActivitiesByTraceSafe(traceId: string): Promise<IActivityRecord[]>;

  /**
   * Get activities by action type.
   */
  getActivitiesByActionType(actionType: string): IActivityRecord[];

  /**
   * Get activities by action type (async/safe version).
   */
  getActivitiesByActionTypeSafe(actionType: string): Promise<IActivityRecord[]>;

  /**
   * Get recently recorded activities.
   */
  getRecentActivity(limit?: number): Promise<IActivityRecord[]>;
}
