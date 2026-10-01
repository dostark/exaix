/**
 * @module ICostTracker
 * @path packages/core/src/types/i_cost_tracker.ts
 * @description Interface for LLM cost tracking and budgeting.
 * @architectural-layer Shared/Interfaces
 * @related-files [packages/core/src/cost/cost_tracker.ts, packages/storage-sqlite/src/database_service.ts]
 */

import type { CostGroupBy, CostSource, ICostFilter, IGroupedCostRecord, IProviderCostRecord } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import type { BindingTransport } from "@exaix/schemas";

/** Binding identity of a costed generation across a flow step binding (Step 8). */
export interface ICostBindingIdentity {
  /** The binding service that hosts and bills the call. */
  service: string;
  /** Binding transport: cloud or local. Local rows never consume a cloud global cap. */
  transport: BindingTransport;
}

/** Typed filter for the cloud global daily cost sum. */
export interface ICostDailyFilter {
  /** The binding service to sum. Absent sums every service. */
  service?: string;
  /** The binding transport to sum. Cloud isolates the global sum, local its own. */
  transport?: BindingTransport;
}

/** Why an atomic daily budget reservation was refused. */
export type CostBudgetDenialReason = "budget_exceeded" | "pricing_unavailable" | "reservation_conflict";

/** Params for an atomic daily budget reservation (Step 8). */
export interface ICostBudgetReservation {
  /** Binding service identity of the call. Per-service caps key off it. */
  service: string;
  /** Binding transport. Cloud consumes the global cap, local never blocks cloud. */
  transport: string;
  /** Adapter-derived provider name (legacy identity) for accounting. */
  provider: string;
  /** A verified upper bound on this call's cost, or undefined when pricing is unknown. */
  estimatedUsd: number;
  /** The global daily cap. Finite only when the operator binding layer is active. */
  globalCapUsd?: number;
  /** A per-service daily cap from the catalog service entry. */
  serviceCapUsd?: number;
  /** Run trace, carried into the reservation. */
  traceId?: string;
}

/** Result of an atomic daily budget reservation. */
export interface ICostBudgetAllowance {
  allowed: boolean;
  reservationId?: string;
  /** Non-null only on rejection. */
  reason?: CostBudgetDenialReason;
}

export interface ICostTracker {
  /**
   * Track a single LLM generation
   */
  trackGeneration(
    provider: string,
    model: string,
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      /** Provider-reported cost, recorded verbatim as provider_reported. */
      costUsd?: number;
      /** Explicit override for the recorded cost source. */
      costSource?: CostSource;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
    },
    traceId?: string,
    portal?: string,
    identity?: Opt<ICostBindingIdentity, Reason.OptionalContext>,
  ): Promise<number>;

  /** Journal token usage without creating a numeric cost row when verified pricing is absent. */
  recordUnpricedGeneration?(
    provider: string,
    model: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
    traceId?: string,
    identity?: Opt<ICostBindingIdentity, Reason.OptionalContext>,
  ): Promise<void>;

  /**
   * Persist a cost record to the database
   */
  persistEntry(record: IProviderCostRecord): Promise<void>;

  /**
   * Query cost records based on criteria
   */
  queryByCriteria(filter: ICostFilter): Promise<IProviderCostRecord[]>;

  /** Sum persisted generation calls by model or portal. */
  queryGroupedByCriteria?(filter: ICostFilter, groupBy: CostGroupBy): Promise<IGroupedCostRecord[]>;

  /**
   * Get total cost for a provider/model
   */
  getTotalCost(provider?: string, model?: string): number;

  /**
   * Get total daily cost for a specific provider or all providers.
   */
  getDailyCost(provider?: string): Promise<number>;

  /** Sum a day's persisted spend under a typed binding filter. The filter isolates the cloud
   *  global cap, a per-service cap, or local usage. This avoids overloading positional
   *  arguments (Step 8). Absent keeps only the legacy provider-based visitor. */
  getDailyBudgetCost?(filter: ICostDailyFilter): Promise<number>;

  /** Atomically count persisted spend plus active reservations against the finite caps.
   *  Reserve an upper bound when the call may proceed. Reject unpriced cloud usage under a
   *  finite cap. Returns an allowance with a reservation id for the caller to settle or
   *  release. Absent keeps the legacy budget path. */
  reserveDailyBudget?(params: ICostBudgetReservation): Promise<ICostBudgetAllowance>;

  /** Settle a reservation with the actual cost after the call. Actual cost above the estimate
   *  is an accounting anomaly and blocks later admissions. */
  settleDailyBudget?(reservationId: string, actualUsd: number): Promise<void>;

  /** Release a reservation when the call failed without incurring cost. */
  releaseDailyBudget?(reservationId: string): Promise<void>;

  /**
   * Flush any pending cost records to the database
   */
  flush(): Promise<void>;

  /**
   * Check if execution is within daily/monthly budget
   */
  isWithinBudget(provider?: string, budget?: number): Promise<boolean>;
}
