/**
 * @module ICostTracker
 * @path src/shared/interfaces/i_cost_tracker.ts
 * @description Interface for LLM cost tracking and budgeting.
 * @architectural-layer Shared/Interfaces
 * @related-files [src/services/cost/cost_tracker.ts, src/services/core/db.ts]
 */

import type { ICostFilter, IProviderCostRecord } from "../types/database.ts";

export interface ICostTracker {
  /**
   * Track a single LLM generation
   */
  trackGeneration(
    provider: string,
    model: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
    traceId?: string,
    portal?: string,
  ): Promise<number>;

  /**
   * Persist a cost record to the database
   */
  persistEntry(record: IProviderCostRecord): Promise<void>;

  /**
   * Query cost records based on criteria
   */
  queryByCriteria(filter: ICostFilter): Promise<IProviderCostRecord[]>;

  /**
   * Get total cost for a provider/model
   */
  getTotalCost(provider?: string, model?: string): number;

  /**
   * Check if execution is within daily/monthly budget
   */
  isWithinBudget(provider?: string, budget?: number): Promise<boolean>;
}
