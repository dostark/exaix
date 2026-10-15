/**
 * @module DefaultModelRegistry
 * @path packages/model-registry/src/default_model_registry.ts
 * @description Solo-tier floor implementation of IModelRegistry. Resolves all 13 methods
 *   using the ProviderRegistry, the static overlay, and
 *   optional provider catalog metadata. Team-only methods throw RegistryNotImplementedError.
 * @architectural-layer ModelRegistry
 * @dependencies [@exaix/core/types, @exaix/ai, @exaix/schemas]
 * @related-files [packages/core/src/types/i_model_registry.ts, packages/ai/src/model_resolver.ts]
 */
import {
  HealthStatus,
  type ICapabilityProfile,
  type IModelEntry,
  type IModelPricing,
  type IModelRegistry,
  type IRateLimitStatus,
} from "@exaix/core/types";
import type { IProviderHealthChecker } from "@exaix/ai";
import { ProviderRegistry, readProviderModelInfo } from "@exaix/ai";
import { getDefaultModels } from "@exaix/schemas";
import { RegistryNotImplementedError } from "./errors.ts";
import { STATIC_CONTEXT_WINDOWS, STATIC_OVERLAY } from "./static_overlay.ts";
import { mtokToPer1k } from "./cost_units.ts";

export class DefaultModelRegistry implements IModelRegistry {
  private callCounts = new Map<string, number>();

  constructor(
    private healthChecker: IProviderHealthChecker,
  ) {}

  async getModelsByCapability(profile: ICapabilityProfile): Promise<IModelEntry[]> {
    const providers = ProviderRegistry.getAllProviders();
    const defaults = getDefaultModels();
    const entries = await Promise.all(
      providers.map((p) => this.buildEntry(p.metadata.name, defaults[p.metadata.name] ?? p.metadata.name)),
    );
    return entries.filter((entry) =>
      this.matchesProfile(
        entry.capabilities,
        profile,
        ProviderRegistry.getProviderMetadata(entry.provider)?.modelInfo !== undefined,
      )
    );
  }

  async getModelCapability(provider: string, model: string): Promise<ICapabilityProfile> {
    const meta = ProviderRegistry.getProviderMetadata(provider);
    const info = await readProviderModelInfo(meta, model);
    const overlayKey = `${provider}:${model}`;
    const overlay = STATIC_OVERLAY[overlayKey];
    return {
      minContextWindow: overlay?.contextWindow ?? STATIC_CONTEXT_WINDOWS[overlayKey] ?? info?.contextWindow ??
        meta?.contextWindow,
      supportsThinking: info?.supportsThinking ?? meta?.supportsThinking,
      supportsEffort: info?.supportsEffort ?? meta?.supportsEffort,
      maxCostPerMillionTokens: overlay?.inputPerMtok ?? info?.inputPerMtok ?? meta?.costPerMtok,
    };
  }

  async getProviderModels(provider: string): Promise<IModelEntry[]> {
    const meta = ProviderRegistry.getProviderMetadata(provider);
    if (!meta) return Promise.resolve([]);
    const defaults = getDefaultModels();
    const model = defaults[meta.name] ?? meta.name;
    return [await this.buildEntry(meta.name, model)];
  }

  getAllProviders(): Promise<string[]> {
    return Promise.resolve(ProviderRegistry.getSupportedProviders());
  }

  async getModelCost(provider: string, model: string): Promise<number> {
    const overlayKey = `${provider}:${model}`;
    const overlay = STATIC_OVERLAY[overlayKey];
    if (overlay?.inputPerMtok !== undefined) return Promise.resolve(overlay.inputPerMtok);
    const meta = ProviderRegistry.getProviderMetadata(provider);
    const info = await readProviderModelInfo(meta, model);
    return info?.inputPerMtok ?? meta?.costPerMtok ?? 0;
  }

  async getContextWindow(provider: string, model: string): Promise<number> {
    const overlayKey = `${provider}:${model}`;
    const overlay = STATIC_OVERLAY[overlayKey];
    if (overlay?.contextWindow !== undefined) return overlay.contextWindow;
    const listed = STATIC_CONTEXT_WINDOWS[overlayKey];
    if (listed !== undefined) return listed;
    const meta = ProviderRegistry.getProviderMetadata(provider);
    try {
      const info = await meta?.modelInfo?.(model);
      if (info?.contextWindow !== undefined) return info.contextWindow;
    } catch {
      // Catalog lookup failures use the provider-level fallback.
    }
    return meta?.contextWindow ?? 0;
  }

  async getModelPricing(provider: string, model: string): Promise<IModelPricing> {
    const overlayKey = `${provider}:${model}`;
    const overlay = STATIC_OVERLAY[overlayKey];
    if (overlay) {
      return Promise.resolve({
        provider,
        model,
        inputPerMtok: overlay.inputPerMtok,
        outputPerMtok: overlay.outputPerMtok,
        cacheReadPerMtok: overlay.cacheReadPerMtok,
        cacheCreationPerMtok: overlay.cacheCreationPerMtok,
        provenance: "static" as const,
        verifiedAt: overlay.verifiedAt,
        sourceUrl: overlay.sourceUrl,
      });
    }
    const info = await readProviderModelInfo(ProviderRegistry.getProviderMetadata(provider), model);
    if (info?.inputPerMtok !== undefined || info?.outputPerMtok !== undefined) {
      return {
        provider,
        model,
        inputPerMtok: info.inputPerMtok,
        outputPerMtok: info.outputPerMtok,
        provenance: "endpoint",
      };
    }
    return { provider, model, provenance: "unknown" as const };
  }

  recordLatency(_provider: string, _model: string, _latencyMs: number): Promise<void> {
    return Promise.resolve();
  }

  getLatencyStats(_provider: string, _model: string): Promise<never> {
    return Promise.reject(new RegistryNotImplementedError("getLatencyStats"));
  }

  rankByLatency(_candidates: Array<{ provider: string; model: string }>): Promise<never> {
    return Promise.reject(new RegistryNotImplementedError("rankByLatency"));
  }

  recordCall(provider: string): Promise<void> {
    const current = this.callCounts.get(provider) ?? 0;
    this.callCounts.set(provider, current + 1);
    return Promise.resolve();
  }

  getRateLimit(provider: string): Promise<IRateLimitStatus> {
    const count = this.callCounts.get(provider) ?? 0;
    return Promise.resolve({ remaining: Math.max(0, 100 - count), maxRpm: 100, resetAt: Date.now() + 60_000 });
  }

  getProviderHealth(provider: string): Promise<HealthStatus> {
    return this.healthChecker.checkProvider(provider).then((healthy) =>
      healthy ? HealthStatus.HEALTHY : HealthStatus.DEGRADED
    );
  }

  private matchesProfile(
    meta: ICapabilityProfile,
    profile: ICapabilityProfile,
    hasCatalog: boolean,
  ): boolean {
    // An unknown window passes only for a provider whose catalog may be unavailable.
    if (
      profile.minContextWindow !== undefined &&
      (meta.minContextWindow ?? (hasCatalog ? Infinity : 0)) < profile.minContextWindow
    ) {
      return false;
    }
    if (profile.supportsThinking === true && meta.supportsThinking !== true) {
      return false;
    }
    if (profile.supportsEffort === true && meta.supportsEffort !== true) {
      return false;
    }
    if (
      profile.maxCostPerMillionTokens !== undefined &&
      (meta.maxCostPerMillionTokens ?? 0) > profile.maxCostPerMillionTokens
    ) {
      return false;
    }
    return true;
  }

  private async buildEntry(provider: string, model: string): Promise<IModelEntry> {
    const capabilities = await this.getModelCapability(provider, model);

    return {
      provider,
      model,
      capabilities,
      contextWindow: capabilities.minContextWindow ?? 0,
      costPer1kTokens: mtokToPer1k(capabilities.maxCostPerMillionTokens ?? 0),
    };
  }
}
