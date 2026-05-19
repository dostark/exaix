/**
 * @module ICostTracker
 * @path packages/core/src/types/i_cost_tracker.ts
 * @description Interface for LLM cost tracking and budgeting.
 * @architectural-layer Shared/Interfaces
 * @related-files [src/services/cost/cost_tracker.ts, packages/storage-sqlite/src/database_service.ts]
 */

import type { ICostFilter, IProviderCostRecord } from "@exaix/core/types";

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
   * Get total daily cost for a specific provider or all providers.
   */
  getDailyCost(provider?: string): Promise<number>;

  /**
   * Flush any pending cost records to the database
   */
  flush(): Promise<void>;

  /**
   * Check if execution is within daily/monthly budget
   */
  isWithinBudget(provider?: string, budget?: number): Promise<boolean>;
}
