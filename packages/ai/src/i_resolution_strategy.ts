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

/** A concrete (provider, model) route the strategy resolved an explicit choice to. */
export interface IResolvedRoute {
  provider: string;
  model: string;
}

export interface IResolutionStrategy {
  /**
   * Validate (and, for Team, auto-admit) an explicit `provider:model` choice against
   * the live catalog. Returns the resolved route, or throws for an unknown model.
   * When absent (Solo), the resolver passes the explicit choice through unchanged.
   */
  validateExplicit?(provider: string, model: string): Promise<IResolvedRoute>;
}
