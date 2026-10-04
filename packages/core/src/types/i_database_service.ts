/**
 * @module IdatabaseService
 * @path packages/core/src/types/i_database_service.ts
 * @description Module for IdatabaseService.
 * @architectural-layer Shared
 * @related-files [@exaix/core/types]
 */

import type { JSONValue } from "@exaix/core";
import type { IActivityRecord, IJournalFilterOptions, SqliteParam } from "@exaix/core/types";
import type { ToolConfirmationDecision, ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";

/** Verify result for the Solo journal hash chain. `unhashed_prefix` counts legacy rows. */
export interface IJournalIntegrityResult {
  ok: boolean;
  rows_checked: number;
  unhashed_prefix: number;
  first_broken_id: string | null;
  expected_hash: string | null;
  actual_hash: string | null;
}

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
    agentRole?: string | null,
    runnerKind?: string | null,
    promptTokens?: number,
    completionTokens?: number,
    costUsd?: number | null,
    cacheReadTokens?: number,
    cacheCreationTokens?: number,
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
   * Verify the Solo journal's activity hash chain. Reports, never throws, on tampering.
   */
  verifyJournalIntegrity(): Promise<IJournalIntegrityResult>;

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

  /**
   * Persist a pending tool confirmation request.
   */
  insertToolConfirmationRequest(request: ToolConfirmationRequest): Promise<void>;

  /**
   * Persist a decision for a previously queued tool confirmation request.
   */
  writeToolConfirmationDecision(
    id: string,
    decision: Omit<ToolConfirmationDecision, "id">,
  ): Promise<void>;

  /**
   * Retrieve a persisted tool confirmation decision.
   */
  getToolConfirmationDecision(id: string): Promise<ToolConfirmationDecision | null>;

  /**
   * List tool confirmation requests that are still awaiting a decision.
   */
  listPendingToolConfirmations(): Promise<ToolConfirmationRequest[]>;
}
