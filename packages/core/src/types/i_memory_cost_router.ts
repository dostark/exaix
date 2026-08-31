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

export interface IMemoryBudgetStatus {
  /** Maximum daily spend allowed for remote memory operations in USD. */
  dailyBudget: number;
  /** Accumulated spend today for remote memory operations in USD. */
  dailyCost: number;
  /** True when dailyCost is within the dailyBudget cap. */
  withinBudget: boolean;
}

/** Decides LOCAL (free) vs REMOTE (paid) tier: no cost tracker configured, or the daily remote budget is
 *  exhausted → LOCAL; otherwise REMOTE. Records operation costs so budget checks account for cumulative daily spend. */
export interface IMemoryCostRouter {
  /** Also emits a `memory.tier_selected` event via the configured logger with the
   *  selected tier and reason. */
  isRemoteAllowed(): Promise<boolean>;

  /** Accumulates toward the daily budget so subsequent `isRemoteAllowed()` calls reflect
   *  the updated spend. `costUsd` e.g. 0.001 for 1/10 of a cent. */
  recordOperation(costUsd: number): Promise<void>;

  getBudgetStatus(): Promise<IMemoryBudgetStatus>;

  /** Updated by `isRemoteAllowed()` on each call; stale between calls, not live-computed. */
  readonly selectedTier: MemoryStorageTier;
}
