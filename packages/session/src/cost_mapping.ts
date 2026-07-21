/**
 * @module CostMapping
 * @path packages/session/src/cost_mapping.ts
 * @description Phase 106 Step 9 — GAP-6 mapping of a delegated return's mandatory
 *   token_stats into an IProviderCostRecord. The provider is `session:<tool>` and
 *   `estimatedCostUsd` is a documented 0 sentinel meaning "external/unmetered":
 *   a human-run tool's USD spend is on the human's own subscription, not metered
 *   by Exaix. The token counts remain the authoritative journaled figures.
 * @architectural-layer Services
 * @dependencies [@exaix/core, @exaix/schemas]
 * @related-files [packages/core/src/types/database.ts, packages/schemas/src/session_delegate.ts]
 */

import { DEFAULT_UNKNOWN_LABEL, SESSION_COST_PROVIDER_PREFIX } from "@exaix/core/types";
import type { IProviderCostRecord } from "@exaix/core/types";
import type { SessionReturn, SessionTool } from "@exaix/schemas/session_delegate.ts";

/** Inputs for building a delegated cost record. */
export interface ISessionCostInput {
  id: string;
  tool: SessionTool;
  sessionReturn: SessionReturn;
  costUsd?: number;
  traceId?: string;
  portal?: string;
  timestamp: Date;
}

/** Map a delegated return's token_stats to an IProviderCostRecord (GAP-6).
 *  Uses `input.costUsd` when provided; falls back to `input.sessionReturn.cost_usd`;
 *  defaults to 0 (external/unmetered sentinel) when absent. */
export function sessionReturnToCostRecord(input: ISessionCostInput): IProviderCostRecord {
  const stats = input.sessionReturn.token_stats;
  const costUsd = input.costUsd ?? input.sessionReturn.cost_usd ?? 0;
  return {
    id: input.id,
    provider: `${SESSION_COST_PROVIDER_PREFIX}${input.tool}`,
    model: stats.model ?? DEFAULT_UNKNOWN_LABEL,
    tokens: stats.total_tokens,
    promptTokens: stats.input_tokens,
    completionTokens: stats.output_tokens,
    estimatedCostUsd: costUsd,
    traceId: input.traceId,
    portal: input.portal,
    timestamp: input.timestamp,
    cacheReadTokens: stats.cache_read_tokens,
    cacheCreationTokens: stats.cache_creation_tokens,
  };
}
