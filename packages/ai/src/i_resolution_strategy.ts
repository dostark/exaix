/**
 * @module IResolutionStrategy
 * @path packages/ai/src/i_resolution_strategy.ts
 * @description Phase 135 (GAP-1) — the Solo-owned seam through which the Team
 *   model-registry module supplies optional resolution behaviours to ModelResolver
 *   without forking it. Every hook is optional: a resolver with no strategy (Solo)
 *   behaves exactly as Phase 134. The Team module (packages-team/model-registry-live)
 *   implements this interface and is injected at daemon bootstrap.
 *
 *   Hooks land incrementally: `validateExplicit` (Step 1 seam / Step 3 semantics),
 *   `selectRoute` (Step 6), `scoreBest` / `rankUsage` (Step 8). Steps 6 and 8 widen
 *   this interface; Step 1 only wires `validateExplicit` into the resolver.
 *
 *   `usage_tiebreak` opt-in gating (F8) is a Team-config concern owned by the strategy
 *   implementation, not the resolver (edition boundary — packages/ai must not read
 *   Team-only config): the resolver always offers `rankUsage` the tied/no-characteristics
 *   candidate pool; a Team strategy with the flag off returns `undefined` (inert).
 * @architectural-layer AI-Routing
 * @dependencies [@exaix/schemas, @exaix/core/types]
 * @related-files [packages/ai/src/model_resolver.ts, packages-team/model-registry-live/mod.ts]
 */
import type { IRouteReason } from "@exaix/schemas";
import type { TaskType } from "@exaix/core/types";

/** A concrete (provider, model) route the strategy resolved an explicit choice to. */
export interface IResolvedRoute {
  provider: string;
  model: string;
}

/** One weighed route surfaced back to the resolver for the trace payload (Step 6). */
export interface IConsideredRouteInput {
  provider: string;
  price?: number;
  health_score: number;
}

/** The strategy's route decision for a non-pinned model choice (Phase 135 Step 6). */
export interface IRouteSelectionResult {
  provider: string;
  model: string;
  route_reason: IRouteReason;
  /** The routes weighed; present (and journalled) only when >1 route existed. */
  considered_routes?: IConsideredRouteInput[];
}

export interface IResolutionStrategy {
  /**
   * Validate (and, for Team, auto-admit) an explicit `provider:model` choice against
   * the live catalog. Returns the resolved route, or throws for an unknown model.
   * When absent (Solo), the resolver passes the explicit choice through unchanged.
   */
  validateExplicit?(provider: string, model: string): Promise<IResolvedRoute>;

  /**
   * Apply the route policy to a non-pinned model choice (Phase 135 Step 6). The resolver
   * calls this after a scored/preset model pick; the strategy looks up all catalog routes
   * for the model and returns the chosen provider + reason. When absent (Solo), the
   * resolver keeps the scored provider and emits no route_reason.
   */
  selectRoute?(resolved: IResolvedRoute): Promise<IRouteSelectionResult>;

  /**
   * Score a candidate pool by the task-relevant benchmark (Phase 135 Step 8, F10/F11).
   * Called only when `best` is a requested characteristic AND taskType is not
   * UNKNOWN/unmapped (the resolver never mis-ranks on an unmapped task-type — it simply
   * skips calling this hook). Returns a score map keyed by provider name in [0,1];
   * a candidate absent from the map is unscored and ranks last (honest degradation,
   * §5.8.3) — the strategy implementation is responsible for emitting
   * `model.benchmark.missing` per unscored candidate. Feeds the SAME weighted blend as
   * `cheapest`/`fastest` inside `scoreCandidates`, not a separate best-only pass.
   */
  scoreBest?(
    candidates: IResolvedRoute[],
    taskType: TaskType,
  ): Promise<Record<string, number>>;

  /**
   * Last-resort MFU/MRU usage tiebreak (Phase 135 Step 8, F8). The resolver offers this
   * hook the tied/no-characteristics candidate pool; a returned array is the ranked
   * provider order (first = most-frequently/most-recently used) and its winner decides
   * the resolution with `reason: "usage_ranked"`. Returning `undefined` is inert — the
   * strategy's own `usage_tiebreak` config gate (Team-owned) is the only place this
   * opt-in is enforced; the resolver has no opinion on it.
   */
  rankUsage?(candidates: IResolvedRoute[]): Promise<string[] | undefined>;
}
