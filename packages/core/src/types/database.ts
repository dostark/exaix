/**
 * @module Database
 * @path @exaix/core/types/database.ts
 * @description Module for Database.
 * @architectural-layer Shared
 * @related-files ["src/services/core/db.ts"]
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
  prompt_tokens?: number;
  completion_tokens?: number;
  cost_usd?: number;
  timestamp: string;
  count?: number;
}

/**
 * Supported parameter types for SQLite queries.
 */
export type SqliteParam = string | number | boolean | null | Uint8Array;

/**
 * Record for tracking provider costs
 */
export interface IProviderCostRecord {
  id: string;
  provider: string;
  model: string;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  traceId?: string;
  portal?: string;
  timestamp: Date;
}

/**
 * Filter for querying cost records
 */
export interface ICostFilter {
  traceId?: string;
  portal?: string;
  since?: Date;
  model?: string;
}
