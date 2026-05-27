/**
 * @module IMemoryCostRouter
 * @path packages/core/src/types/i_memory_cost_router.ts
 * @description Interface for cost-aware memory storage tier routing.
 * Determines whether remote (paid) memory operations are allowed based on
 * daily budget, and records operation costs for budget tracking.
 * @architectural-layer Core
 * @related-files [packages/core/src/types/i_cost_tracker.ts, packages/core/src/cost/memory_cost_router.ts, packages/core/src/cost/cost_tracker.ts]
 */
import type { MemoryStorageTier } from "./enums.ts";

/**
 * Budget status snapshot for a memory storage tier.
 * Provides the daily budget cap, current accumulated cost, and whether
 * the budget has been exceeded.
 */
export interface IMemoryBudgetStatus {
  /** Maximum daily spend allowed for remote memory operations in USD. */
  dailyBudget: number;
  /** Accumulated spend today for remote memory operations in USD. */
  dailyCost: number;
  /** True when dailyCost is within the dailyBudget cap. */
  withinBudget: boolean;
}

/**
 * Cost-aware router for memory storage tier selection.
 *
 * Decides whether a memory operation should use the LOCAL (free, no
 * embedding API needed) or REMOTE (paid, calls embedding provider) tier
 * based on available budget. Records operation costs so budget checks
 * account for cumulative daily spend.
 *
 * ## Tier selection logic
 *
 * 1. If no cost tracker is configured, always returns LOCAL (conservative default).
 * 2. If the daily budget for remote operations is exhausted, returns LOCAL.
 * 3. Otherwise returns REMOTE (within budget, remote operations allowed).
 *
 * ## Usage
 *
 * ```ts
 * const router = new MemoryCostRouter(costTracker, logger, 2.0);
 * const allowed = await router.isRemoteAllowed();
 * if (allowed) {
 *   await callEmbeddingProvider();
 *   await router.recordOperation(0.001);
 * }
 * ```
 */
export interface IMemoryCostRouter {
  /**
   * Check whether a remote (paid) memory operation is allowed under the
   * current daily budget. Returns false when the budget is exhausted.
   *
   * Emits a `memory.tier_selected` event via the configured logger with
   * the selected tier and reason for the decision.
   */
  isRemoteAllowed(): Promise<boolean>;

  /**
   * Record the cost of a completed remote memory operation.
   * Accumulates toward the daily budget so subsequent `isRemoteAllowed()`
   * calls reflect the updated spend. Accepts USD cost (e.g. 0.001 for 1/10
   * of a cent).
   */
  recordOperation(costUsd: number): Promise<void>;

  /**
   * Returns the current budget status — daily cap, accumulated spend, and
   * whether the operation is within budget. Useful for diagnostics and CLI
   * reporting.
   */
  getBudgetStatus(): Promise<IMemoryBudgetStatus>;

  /**
   * The currently selected storage tier. Updated by `isRemoteAllowed()`
   * on each call to reflect the most recent decision.
   */
  readonly selectedTier: MemoryStorageTier;
}
