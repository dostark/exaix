/**
 * @module TeamResolutionStrategy
 * @path packages-team/model-registry-live/src/team_resolution_strategy.ts
 * @description Phase 135 Step 3 (G10 Team side) — the Team implementation of the
 *   Solo-owned IResolutionStrategy seam (GAP-1). This step wires `validateExplicit`:
 *   an explicit provider:model in the live catalog resolves verbatim; a real-but-
 *   unadmitted model is verified via the provider's adapter, auto-admitted
 *   (model.admitted{explicit_use}), and resolved; a not-real model throws "unknown
 *   model". Steps 6/8 add selectRoute/scoreBest/rankUsage to the same class.
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix/ai, @exaix/model-registry, @exaix/core]
 * @related-files [packages/ai/src/i_resolution_strategy.ts, packages-team/model-registry-live/src/model_registry_service.ts]
 */
import type { IResolutionStrategy, IResolvedRoute } from "@exaix/ai";
import type { IAdapterContext, ICatalogEntry, IProviderCatalogAdapter } from "@exaix/model-registry";
import type { IEventLogger } from "@exaix/core/logger";
import type { ModelRegistryService } from "./model_registry_service.ts";

/** Adapter-lookup + context-build seam the strategy uses to verify explicit choices. */
export interface ITeamStrategyDeps {
  getAdapter(provider: string): IProviderCatalogAdapter | undefined;
  buildContext(provider: string): IAdapterContext;
  /** True when the provider is an aggregator reseller (§5.7.2 isAggregator metadata). */
  isAggregator(provider: string): boolean;
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
    });
    return { provider, model };
  }
}
