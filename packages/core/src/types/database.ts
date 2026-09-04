/**
 * @module Database
 * @path packages/core/src/types/database.ts
 * @description Module for Database.
 * @architectural-layer Shared
 * @related-files ["packages/storage-sqlite/src/database_service.ts"]
 */

import type { CostSource } from "./i_model_pricing_lookup.ts";

/**
 * Filter options for querying activity journal.
 */
export interface IJournalFilterOptions {
  traceId?: string;
  actionType?: string;
  agentRole?: string;
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
  agent_role: string | null;
  runner_kind?: string | null;
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
  /** Prompt-cache read tokens. undefined when the tool doesn't report cache usage —
   *  never 0 for "unknown". */
  cacheReadTokens?: number;
  /** Prompt-cache write (creation) tokens, one-time per cache segment. */
  cacheCreationTokens?: number;
  /** Reasoning/thinking tokens, when the provider/tool reports a breakdown (subset of
   *  completionTokens, billed as output). undefined when it doesn't report one — never 0
   *  for "no reasoning happened". */
  reasoningTokens?: number;
  /** How this record's cost was priced (provider_costs.cost_source):
   *  undefined means the legacy blended estimate (no reported or computed figure). */
  costSource?: CostSource;
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
