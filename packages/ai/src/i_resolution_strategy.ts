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
 * @architectural-layer AI-Routing
 * @dependencies [@exaix/schemas]
 * @related-files [packages/ai/src/model_resolver.ts, packages-team/model-registry-live/mod.ts]
 */
import type { IRouteReason } from "@exaix/schemas";

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
}
