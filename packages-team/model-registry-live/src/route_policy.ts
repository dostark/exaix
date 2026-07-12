/**
 * @module RoutePolicy
 * @path packages-team/model-registry-live/src/route_policy.ts
 * @description Phase 135 Step 6 (F9 + G4) — multi-route selection. routesFor(model)
 *   reads the live-catalog route inventory; routeHealthScore composes the §5.7.3
 *   sub-signals (circuit + failure-headroom, renormalising when a signal is absent);
 *   and select() applies one of four policies — cheapest (D7-exempt route wins $0
 *   without a lookup; unknown-priced loses to any priced route, F1; near-ties broken by
 *   health), reliability, native_first, user_order (G4, falls to cheapest). A route is a
 *   provider, so health reads the per-provider circuit breaker via the injected provider
 *   (F3 — no per-route health state).
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix/model-registry, @exaix/core/types]
 * @related-files [packages-team/model-registry-live/src/team_resolution_strategy.ts, packages/core/src/types/constants.ts]
 */
import { ROUTE_HEALTH_WEIGHT_CIRCUIT, ROUTE_HEALTH_WEIGHT_FAILURE_COUNT } from "@exaix/core/types";
import type { Opt, ProviderCostTier, Reason } from "@exaix/core/types";
import type { IRouteReason } from "@exaix/schemas";
import { isCostExempt } from "@exaix/model-registry";
import type { ModelRegistryService } from "./model_registry_service.ts";

/** The §5.7.3 sub-signals available for one route (absent fields renormalise). */
export interface IRouteHealthSignals {
  /** Circuit state mapped to [0,1]: CLOSED=1, HALF_OPEN=0.5, OPEN=0. */
  circuitState?: number;
  /** 1 − failureCount/failureThreshold — distance from tripping, [0,1]. */
  failureHeadroom?: number;
}

/** Supplies per-route (per-provider) health sub-signals (F3 read-through). */
export interface IRouteHealthProvider {
  routeHealth(provider: string): IRouteHealthSignals;
}

/** The provider-metadata cost fields isCostExempt reads (D7). */
export interface IProviderCostMetadata {
  costTier?: ProviderCostTier;
  costPerMtok?: number;
}

/** Extra route metadata the policy needs beyond the catalog/pricing/health seams. */
export interface IRoutePolicyDeps {
  isAggregator(provider: string): boolean;
  /** D7: true when the provider is cost-exempt by metadata (LOCAL/FREE tier) — $0, no lookup. */
  costExempt(provider: string): boolean;
  /**
   * D7 fallback signal: the provider's cost metadata, for the post-pricing-lookup
   * isCostExempt(metadata, pricing) check (endpoint $0 price — costExempt(provider)
   * alone only catches LOCAL/FREE tier, not a $0 endpoint price on a nominally-paid tier).
   */
  providerCostMetadata(provider: string): IProviderCostMetadata | undefined;
}

/** One weighed route in a decision. */
export interface IRouteCandidate {
  provider: string;
  model: string;
  price?: number;
  healthScore: number;
  costExempt: boolean;
}

/** The chosen route + the routes weighed (for the trace/event). */
export interface IRouteSelection {
  route: { provider: string; model: string };
  reason: IRouteReason;
  considered: IRouteCandidate[];
}

/** Options threaded from config for one selection. */
export interface IRouteSelectOptions {
  priceTolerance: number;
  routeOrder: Record<string, string[]>;
}

/**
 * Composite route_health_score ∈ [0,1] over the sub-signals that have data:
 * Σ(wᵢ·sᵢ)/Σ(wᵢ). A sub-signal with no value drops out; if none are present the score
 * is a neutral 1 (nothing is known against the route).
 */
export function routeHealthScore(signals: IRouteHealthSignals): number {
  let weighted = 0;
  let weightSum = 0;
  if (signals.circuitState !== undefined) {
    weighted += ROUTE_HEALTH_WEIGHT_CIRCUIT * signals.circuitState;
    weightSum += ROUTE_HEALTH_WEIGHT_CIRCUIT;
  }
  if (signals.failureHeadroom !== undefined) {
    weighted += ROUTE_HEALTH_WEIGHT_FAILURE_COUNT * signals.failureHeadroom;
    weightSum += ROUTE_HEALTH_WEIGHT_FAILURE_COUNT;
  }
  if (weightSum === 0) return 1;
  return weighted / weightSum;
}

export class RoutePolicy {
  constructor(
    private readonly registry: ModelRegistryService,
    private readonly health: IRouteHealthProvider,
    private readonly deps: IRoutePolicyDeps,
  ) {}

  /** All providers offering `model` in the live catalog (§5.7.5 route inventory). */
  routesFor(model: string): Promise<Array<{ provider: string; model: string }>> {
    return this.registry.getModelRoutes(model);
  }

  /**
   * Choose a route for `model` under `policy`. Returns the chosen route, the deciding
   * reason, and every weighed candidate (for the trace payload). A model with 0 or 1
   * routes short-circuits (the caller maps 1 route to `single_route`).
   */
  async select(model: string, policy: IRouteReason, opts: IRouteSelectOptions): Promise<IRouteSelection> {
    const routes = await this.routesFor(model);
    const candidates = await Promise.all(routes.map((r) => this.toCandidate(r.provider, model)));

    let chosen: IRouteCandidate;
    let reason: IRouteReason = policy;
    switch (policy) {
      case "reliability":
        chosen = this.pickReliability(candidates);
        break;
      case "native_first":
        chosen = this.pickNativeFirst(candidates);
        break;
      case "user_order": {
        const ordered = this.pickUserOrder(candidates, opts.routeOrder[model]);
        if (ordered) {
          chosen = ordered;
        } else {
          chosen = this.pickCheapest(candidates, opts.priceTolerance);
          reason = "cheapest"; // G4: missing route_order entry falls to cheapest
        }
        break;
      }
      default:
        chosen = this.pickCheapest(candidates, opts.priceTolerance);
        reason = "cheapest";
    }
    return { route: { provider: chosen.provider, model }, reason, considered: candidates };
  }

  private async toCandidate(provider: string, model: string): Promise<IRouteCandidate> {
    const healthScore = routeHealthScore(this.health.routeHealth(provider));
    // D7: a metadata cost-exempt route is $0 without a pricing lookup.
    if (this.deps.costExempt(provider)) {
      return { provider, model, price: 0, healthScore, costExempt: true };
    }
    const pricing = await this.registry.getModelPricing(provider, model);
    const price = pricing.inputPerMtok; // per-Mtok input price is the comparison key
    // D7 fallback: a $0 endpoint price on a nominally-paid tier is also exempt.
    const metadata = this.deps.providerCostMetadata(provider);
    const exemptByPrice = isCostExempt(metadata, { costPerMtok: price, provenance: pricing.provenance });
    return { provider, model, price: price ?? undefined, healthScore, costExempt: exemptByPrice };
  }

  /** F1 + D7: exempt/$0 routes rank first; unknown-priced loses to any priced route. */
  private pickCheapest(candidates: IRouteCandidate[], tolerance: number): IRouteCandidate {
    const priceOf = (c: IRouteCandidate): number => {
      if (c.costExempt) return 0;
      return c.price ?? Number.POSITIVE_INFINITY; // unknown price → worst (F1)
    };
    const sorted = [...candidates].sort((a, b) => priceOf(a) - priceOf(b));
    const best = sorted[0];
    const bestPrice = priceOf(best);
    // Near-ties within tolerance broken by health score (higher wins).
    const withinTolerance = sorted.filter((c) => {
      const p = priceOf(c);
      if (!Number.isFinite(p) || !Number.isFinite(bestPrice)) return p === bestPrice;
      if (bestPrice === 0) return p === 0;
      return (p - bestPrice) / bestPrice <= tolerance;
    });
    return withinTolerance.reduce((a, b) => (b.healthScore > a.healthScore ? b : a));
  }

  private pickReliability(candidates: IRouteCandidate[]): IRouteCandidate {
    return candidates.reduce((a, b) => (b.healthScore > a.healthScore ? b : a));
  }

  /** Prefer the healthiest native (isAggregator !== true); unhealthy native → healthiest aggregator. */
  private pickNativeFirst(candidates: IRouteCandidate[]): IRouteCandidate {
    const natives = candidates.filter((c) => !this.deps.isAggregator(c.provider));
    const healthyNative = natives.filter((c) => c.healthScore > 0);
    if (healthyNative.length > 0) {
      return healthyNative.reduce((a, b) => (b.healthScore > a.healthScore ? b : a));
    }
    // No healthy native → the healthiest overall (aggregators included).
    return this.pickReliability(candidates);
  }

  /** Walk route_order; return the first entry present in the catalog, else undefined (G4). */
  private pickUserOrder(
    candidates: IRouteCandidate[],
    order?: Opt<string[], Reason.OptionalInput>,
  ): IRouteCandidate | undefined {
    if (!order || order.length === 0) return undefined;
    for (const provider of order) {
      const match = candidates.find((c) => c.provider === provider);
      if (match) return match;
    }
    return undefined;
  }
}
