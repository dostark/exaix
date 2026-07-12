/**
 * @module TeamResolutionStrategy
 * @path packages-team/model-registry-live/src/team_resolution_strategy.ts
 * @description Phase 135 Step 3 (G10 Team side) — the Team implementation of the
 *   Solo-owned IResolutionStrategy seam (GAP-1). This step wires `validateExplicit`:
 *   an explicit provider:model in the live catalog resolves verbatim; a real-but-
 *   unadmitted model is verified via the provider's adapter, auto-admitted
 *   (model.admitted{explicit_use}), and resolved; a not-real model throws "unknown
 *   model". Step 6 adds selectRoute; Step 8 adds scoreBest (benchmark_map ranking,
 *   honest degradation via model.benchmark.missing) and rankUsage (opt-in MFU/MRU
 *   tiebreak, self-gated on the deps.usageTiebreak config flag).
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix/ai, @exaix/model-registry, @exaix/core]
 * @related-files [packages/ai/src/i_resolution_strategy.ts, packages-team/model-registry-live/src/model_registry_service.ts]
 */
import type { IResolutionStrategy, IResolvedRoute, IRouteSelectionResult } from "@exaix/ai";
import type { IAdapterContext, ICatalogEntry, IProviderCatalogAdapter } from "@exaix/model-registry";
import type { IEventLogger } from "@exaix/core/logger";
import {
  DomainEventType,
  type IModelBenchmarkMissingPayload,
  type IModelRouteSelectedPayload,
} from "@exaix/core/events";
import type { IRouteReason } from "@exaix/schemas";
import type { TaskType } from "@exaix/core/types";
import { RoutePolicy } from "./route_policy.ts";
import type { IProviderCostMetadata, IRouteHealthSignals } from "./route_policy.ts";
import type { ModelRegistryService } from "./model_registry_service.ts";

/** Adapter-lookup + context-build seam the strategy uses to verify explicit choices. */
export interface ITeamStrategyDeps {
  getAdapter(provider: string): IProviderCatalogAdapter | undefined;
  buildContext(provider: string): IAdapterContext;
  /** True when the provider is an aggregator reseller (§5.7.2 isAggregator metadata). */
  isAggregator(provider: string): boolean;
  /** Per-route health sub-signals for the §5.7 route policy (Step 6). */
  routeHealth(provider: string): IRouteHealthSignals;
  /** D7: true when the provider is cost-exempt by metadata (LOCAL/FREE) — Step 6. */
  costExempt(provider: string): boolean;
  /** D7 fallback signal: provider cost metadata for the post-pricing-lookup isCostExempt check. */
  providerCostMetadata(provider: string): IProviderCostMetadata | undefined;
  /** Configured route policy (Step 6). */
  routePolicy: IRouteReason;
  /** Configured near-tie price tolerance for cheapest (Step 6). */
  routePriceTolerance: number;
  /** Configured per-model provider order for user_order (G4, Step 6). */
  routeOrder: Record<string, string[]>;
  /** §5.8.4 task-type → ranking benchmark(s), canonical TaskType keys (Step 8, GAP-B). */
  benchmarkMap?: Partial<Record<TaskType, string[]>>;
  /** F8 opt-in — the strategy's own config gate for rankUsage (Step 8). Default false. */
  usageTiebreak?: boolean;
}

const ADMISSION_TOP_N = 25;

export class TeamResolutionStrategy implements IResolutionStrategy {
  constructor(
    private readonly registry: ModelRegistryService,
    private readonly logger: IEventLogger,
    private readonly deps: ITeamStrategyDeps,
  ) {}

  /**
   * Team explicit semantics (G10): admitted → verbatim; real-but-unadmitted →
   * auto-admit + resolve; not real → throw unknown model.
   */
  async validateExplicit(provider: string, model: string): Promise<IResolvedRoute> {
    const admittedModels = await this.registry.getProviderModels(provider);
    if (admittedModels.some((m) => m.model === model)) {
      return { provider, model };
    }

    const adapter = this.deps.getAdapter(provider);
    if (!adapter) {
      throw new Error(`unknown model "${provider}:${model}" — no catalog adapter for provider "${provider}".`);
    }

    const live = await adapter.fetchCatalog(this.deps.buildContext(provider));
    const liveEntry = live.find((e) => e.model === model);
    if (!liveEntry) {
      throw new Error(`unknown model "${provider}:${model}" — not offered by provider "${provider}".`);
    }

    // Real but unadmitted → auto-admit on first use without evicting the already-
    // admitted rows (§5.9): re-present the existing catalog plus the new model, and
    // admit exactly that union (existing rows stay curated, the new one is explicit_use).
    const existingEntries: ICatalogEntry[] = admittedModels.map((m) => ({
      model: m.model,
      contextWindow: m.contextWindow,
    }));
    const isAggregator = this.deps.isAggregator(provider);
    await this.registry.applyRefresh(provider, [...existingEntries, liveEntry], {
      curatedModels: new Set(admittedModels.map((m) => m.model)),
      usedModels: new Set([model]),
      isAggregator,
      keepNativeWhole: !isAggregator,
      topN: ADMISSION_TOP_N,
      // Auto-admit re-presents only the current union; the benchmark top-N path is not
      // re-derived here (the scheduled refresh owns it), so an empty set is correct.
      benchmarkTopN: new Set(),
    });
    return { provider, model };
  }

  /**
   * Route sub-step (§5.7, Step 6): apply the configured policy over all catalog routes
   * for the chosen model. A model with one route short-circuits with `single_route` and
   * emits no event; a multi-route decision emits model.route.selected and carries the
   * considered routes back for the trace payload.
   */
  async selectRoute(resolved: IResolvedRoute): Promise<IRouteSelectionResult> {
    const policy = new RoutePolicy(this.registry, { routeHealth: (p) => this.deps.routeHealth(p) }, {
      isAggregator: (p) => this.deps.isAggregator(p),
      costExempt: (p) => this.deps.costExempt(p),
      providerCostMetadata: (p) => this.deps.providerCostMetadata(p),
    });
    const routes = await policy.routesFor(resolved.model);
    if (routes.length <= 1) {
      // 0 routes: keep the scored provider (catalog has no route inventory for it).
      return { provider: resolved.provider, model: resolved.model, route_reason: "single_route" };
    }

    const selection = await policy.select(resolved.model, this.deps.routePolicy, {
      priceTolerance: this.deps.routePriceTolerance,
      routeOrder: this.deps.routeOrder,
    });
    const consideredRoutes = selection.considered.map((c) => ({
      provider: c.provider,
      price: c.price,
      health_score: c.healthScore,
    }));
    const payload: IModelRouteSelectedPayload = {
      model: resolved.model,
      chosen_provider: selection.route.provider,
      policy: selection.reason,
      considered: consideredRoutes,
    };
    // The nested `considered` array is serialised for the flat LogMetadata surface.
    await this.logger.info(DomainEventType.ModelRouteSelected, resolved.model, {
      model: payload.model,
      chosen_provider: payload.chosen_provider,
      policy: payload.policy,
      considered: JSON.stringify(payload.considered),
    });

    return {
      provider: selection.route.provider,
      model: resolved.model,
      route_reason: selection.reason,
      considered_routes: consideredRoutes,
    };
  }

  /**
   * `best` characteristic (§5.8.3, Step 8): rank candidates by the first
   * `benchmarkMap[taskType]` benchmark with a score, descending. A candidate with no
   * score on ANY of the task's benchmarks is left OUT of the returned map (honest
   * degradation — the resolver's blend then ranks it last) and emits
   * model.benchmark.missing naming the first (primary) benchmark for the task.
   */
  async scoreBest(
    candidates: IResolvedRoute[],
    taskType: TaskType,
  ): Promise<Record<string, number>> {
    const benchmarks = this.deps.benchmarkMap?.[taskType];
    const scores: Record<string, number> = {};
    if (!benchmarks?.length) return scores;

    for (const candidate of candidates) {
      let scored = false;
      for (const benchmark of benchmarks) {
        const score = await this.registry.getBenchmark(candidate.provider, candidate.model, benchmark);
        if (score !== undefined) {
          scores[candidate.provider] = score;
          scored = true;
          break;
        }
      }
      if (!scored) {
        const payload: IModelBenchmarkMissingPayload = {
          provider: candidate.provider,
          model: candidate.model,
          benchmark: benchmarks[0],
          task_type: taskType,
        };
        await this.logger.info(DomainEventType.ModelBenchmarkMissing, candidate.model, { ...payload });
      }
    }
    return scores;
  }

  /**
   * Usage tiebreak (F8, Step 8): MFU then MRU order over provider_costs, restricted to
   * the offered candidate pool. Self-gated on deps.usageTiebreak — returns undefined
   * (inert) when the flag is off, regardless of what the resolver offers.
   */
  async rankUsage(candidates: IResolvedRoute[]): Promise<string[] | undefined> {
    if (!this.deps.usageTiebreak) return undefined;
    const ranked = await this.registry.getUsageRank();
    const candidateProviders = new Set(candidates.map((c) => c.provider));
    const order = ranked.filter((r) => candidateProviders.has(r.provider)).map((r) => r.provider);
    return order.length > 0 ? order : undefined;
  }
}
