/**
 * @module ProviderRegistry
 * @path packages/ai/src/provider_registry.ts
 * @description central registry for all LLM provider factories, managing provider discovery, metadata, and selection logic.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers.ts, "packages/execution/src/agent_runner.ts"]
 */
import { type ChatFormat, PricingTier, PriorityLevel, type ProviderCostTier } from "@exaix/core";
import type { IProviderFactory } from "./factories/abstract_provider_factory.ts";

type ProviderRegistryGlobal = typeof globalThis & {
  __exaixRegisteredProviderTypes?: string[];
};

/** Metadata describing a provider's capabilities, used for selection and cost optimization. */
export interface IProviderMetadata {
  /** Unique provider name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Supported capabilities (e.g., "chat", "streaming", "vision") */
  capabilities: string[];
  /** Cost tier classification */
  costTier: ProviderCostTier;
  /** Optional free tier quota limits */
  freeQuota?: {
    requestsPerDay?: number;
    requestsPerMinute?: number;
    tokensPerMonth?: number;
  };
  /** Pricing tier for cost-based sorting */
  pricingTier: PricingTier;
  /** Task types this provider excels at */
  strengths: readonly string[];
  /** Whether this provider supports extended reasoning (thinking) mode */
  supportsThinking?: boolean;
  /** Whether this provider supports reasoning effort tiers (low/medium/high) */
  supportsEffort?: boolean;
  /** Cost per million tokens in USD (used for characteristic scoring) */
  costPerMtok?: number;
  /** Context window size in tokens (used for model size matching) */
  contextWindow?: number;
  /** True when this provider is an aggregator reseller (e.g. OpenRouter) rather than a first-party host; skipped by native-admission and route-policy logic. */
  isAggregator?: boolean;
  /** True when generate() serializes IModelOptions.tools/toolChoice into a real API request; the capability gate reads this to pick native tool-calling vs the TOML-block prose convention (absent/undefined behaves as false). */
  supportsNativeTools?: boolean;
  /** Chat protocol format supported by this provider. */
  chatFormat?: ChatFormat;
}

function syncRegisteredProviderTypes(providerTypes: Iterable<string>): void {
  const globalRegistry = globalThis as ProviderRegistryGlobal;
  globalRegistry.__exaixRegisteredProviderTypes = Array.from(providerTypes);
}

// Interfaces

// Provider Registry

export class ProviderRegistry {
  private static factories = new Map<string, IProviderFactory>();
  private static metadata = new Map<string, IProviderMetadata>();

  static register(providerType: string, factory: IProviderFactory): void {
    this.factories.set(providerType, factory);
    syncRegisteredProviderTypes(this.factories.keys());
  }

  static registerWithMetadata(
    providerType: string,
    factory: IProviderFactory,
    metadata: IProviderMetadata,
  ): void {
    this.factories.set(providerType, factory);
    this.metadata.set(providerType, metadata);
    syncRegisteredProviderTypes(this.factories.keys());
  }

  static getFactory(providerType: string): IProviderFactory | undefined {
    return this.factories.get(providerType);
  }

  static getProviderMetadata(providerType: string): IProviderMetadata | undefined {
    return this.metadata.get(providerType);
  }

  static getSupportedProviders(): string[] {
    return Array.from(this.factories.keys());
  }

  static getProvidersByCostTier(costTier: ProviderCostTier): string[] {
    return Array.from(this.metadata.entries())
      .filter(([, metadata]) => metadata.costTier === costTier)
      .map(([providerType]) => providerType);
  }

  /** Providers for a task type, sorted from cheapest to most expensive. */
  static getProvidersForTask(taskType: string): string[] {
    return Array.from(this.metadata.entries())
      .filter(([, metadata]) => metadata.strengths.includes(taskType))
      .sort(([, a], [, b]) => this.costPriority(a.pricingTier) - this.costPriority(b.pricingTier))
      .map(([providerType]) => providerType);
  }

  /** Numeric sort priority for a pricing tier; lower value means cheaper. */
  private static costPriority(pricingTier: PricingTier): number {
    switch (pricingTier) {
      case PricingTier.LOCAL:
        return PriorityLevel.LOCAL;
      case PricingTier.FREE:
        return 1; // Not in enum, but keep for now
      case PricingTier.LOW:
        return PriorityLevel.LOW;
      case PricingTier.MEDIUM:
        return PriorityLevel.MEDIUM;
      case PricingTier.HIGH:
        return PriorityLevel.HIGH;
      default:
        return PriorityLevel.DEFAULT;
    }
  }

  static getAllProviders(): Array<{ factory: IProviderFactory; metadata: IProviderMetadata }> {
    return Array.from(this.metadata.entries()).map(([providerType, metadata]) => ({
      factory: this.factories.get(providerType)!,
      metadata,
    }));
  }

  /** Clears all registered factories and metadata; used to isolate tests. */
  static clear(): void {
    this.factories.clear();
    this.metadata.clear();
    syncRegisteredProviderTypes([]);
  }
}
