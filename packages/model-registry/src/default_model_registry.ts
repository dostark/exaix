/**
 * @module DefaultModelRegistry
 * @path packages/model-registry/src/default_model_registry.ts
 * @description Solo-tier floor implementation of IModelRegistry. Resolves all 13 methods
 *   using the ProviderRegistry, the static overlay, and
 *   zero network/DB access. Methods that belong to the Team+ tier throw RegistryNotImplementedError.
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
import { ProviderRegistry } from "@exaix/ai";
import { getDefaultModels } from "@exaix/schemas";
import { RegistryNotImplementedError } from "./errors.ts";
import { STATIC_OVERLAY } from "./static_overlay.ts";
import { mtokToPer1k } from "./cost_units.ts";

export class DefaultModelRegistry implements IModelRegistry {
  private callCounts = new Map<string, number>();

  constructor(
    private healthChecker: IProviderHealthChecker,
  ) {}

  getModelsByCapability(profile: ICapabilityProfile): Promise<IModelEntry[]> {
    const providers = ProviderRegistry.getAllProviders();
    const defaults = getDefaultModels();
    return Promise.resolve(
      providers
        .filter((p) => this.matchesProfile(p.metadata, profile))
        .map((p) => {
          const model = defaults[p.metadata.name] ?? p.metadata.name;
          return this.buildEntry(p.metadata.name, model);
        }),
    );
  }

  getModelCapability(provider: string, _model: string): Promise<ICapabilityProfile> {
    const meta = ProviderRegistry.getProviderMetadata(provider);
    return Promise.resolve({
      minContextWindow: meta?.contextWindow,
      supportsThinking: meta?.supportsThinking,
      supportsEffort: meta?.supportsEffort,
      maxCostPerMillionTokens: meta?.costPerMtok,
    });
  }

  getProviderModels(provider: string): Promise<IModelEntry[]> {
    const meta = ProviderRegistry.getProviderMetadata(provider);
    if (!meta) return Promise.resolve([]);
    const defaults = getDefaultModels();
    const model = defaults[meta.name] ?? meta.name;
    return Promise.resolve([this.buildEntry(meta.name, model)]);
  }

  getAllProviders(): Promise<string[]> {
    return Promise.resolve(ProviderRegistry.getSupportedProviders());
  }

  getModelCost(provider: string, model: string): Promise<number> {
    const overlayKey = `${provider}:${model}`;
    const overlay = STATIC_OVERLAY[overlayKey];
    if (overlay?.inputPerMtok !== undefined) return Promise.resolve(overlay.inputPerMtok);
    const meta = ProviderRegistry.getProviderMetadata(provider);
    return Promise.resolve(meta?.costPerMtok ?? 0);
  }

  getContextWindow(provider: string, model: string): Promise<number> {
    const overlayKey = `${provider}:${model}`;
    const overlay = STATIC_OVERLAY[overlayKey];
    if (overlay?.contextWindow !== undefined) return Promise.resolve(overlay.contextWindow);
    const meta = ProviderRegistry.getProviderMetadata(provider);
    return Promise.resolve(meta?.contextWindow ?? 0);
  }

  getModelPricing(provider: string, model: string): Promise<IModelPricing> {
    const overlayKey = `${provider}:${model}`;
    const overlay = STATIC_OVERLAY[overlayKey];
    if (overlay) {
      return Promise.resolve({
        provider,
        model,
        inputPerMtok: overlay.inputPerMtok,
        outputPerMtok: overlay.outputPerMtok,
        provenance: "static" as const,
        verifiedAt: overlay.verifiedAt,
        sourceUrl: overlay.sourceUrl,
      });
    }
    return Promise.resolve({ provider, model, provenance: "unknown" as const });
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
    meta: { costPerMtok?: number; contextWindow?: number; supportsThinking?: boolean; supportsEffort?: boolean },
    profile: ICapabilityProfile,
  ): boolean {
    if (profile.minContextWindow !== undefined && (meta.contextWindow ?? 0) < profile.minContextWindow) {
      return false;
    }
    if (profile.supportsThinking === true && meta.supportsThinking !== true) {
      return false;
    }
    if (profile.supportsEffort === true && meta.supportsEffort !== true) {
      return false;
    }
    if (profile.maxCostPerMillionTokens !== undefined && (meta.costPerMtok ?? 0) > profile.maxCostPerMillionTokens) {
      return false;
    }
    return true;
  }

  private buildEntry(provider: string, model: string): IModelEntry {
    const overlayKey = `${provider}:${model}`;
    const overlay = STATIC_OVERLAY[overlayKey];
    const meta = ProviderRegistry.getProviderMetadata(provider);

    const contextWindow = overlay?.contextWindow ??
      meta?.contextWindow ??
      0;

    const costPerMtok = overlay?.inputPerMtok ?? meta?.costPerMtok ?? 0;

    return {
      provider,
      model,
      capabilities: {
        minContextWindow: contextWindow,
        supportsThinking: meta?.supportsThinking,
        supportsEffort: meta?.supportsEffort,
        maxCostPerMillionTokens: costPerMtok,
      },
      contextWindow,
      costPer1kTokens: mtokToPer1k(costPerMtok),
    };
  }
}
