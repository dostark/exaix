/**
 * @module ProviderRegistry
 * @path packages/ai/src/provider_registry.ts
 * @description central registry for all LLM provider factories, managing provider discovery, metadata, and selection logic.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers.ts, "packages/execution/src/agent_runner.ts"]
 */
import { PricingTier, PriorityLevel, type ProviderCostTier } from "@exaix/core";
import type { IProviderFactory } from "./factories/abstract_provider_factory.ts";

type ProviderRegistryGlobal = typeof globalThis & {
  __exaixRegisteredProviderTypes?: string[];
};

/**
 * Metadata describing a provider's capabilities and characteristics.
 * Used for intelligent provider selection and cost optimization.
 */
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
  /**
   * True when this provider is an aggregator reseller (e.g. OpenRouter) rather than a
   * first-party model host. Absent for native providers. Read by F12 native admission
   * (keep-native-whole skips aggregators) and the Step 6 `native_first` route policy
   * (§5.7.2).
   */
  isAggregator?: boolean;
}

function syncRegisteredProviderTypes(providerTypes: Iterable<string>): void {
  const globalRegistry = globalThis as ProviderRegistryGlobal;
  globalRegistry.__exaixRegisteredProviderTypes = Array.from(providerTypes);
}

// ============================================================================
// Interfaces
// ============================================================================

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * Registry for provider factories.
 * Manages registration and lookup of provider factories by type.
 */
export class ProviderRegistry {
  private static factories = new Map<string, IProviderFactory>();
  private static metadata = new Map<string, IProviderMetadata>();

  /**
   * Register a factory for a specific provider type.
   * @param providerType The provider type this factory handles
   * @param factory The factory instance
   */
  static register(providerType: string, factory: IProviderFactory): void {
    this.factories.set(providerType, factory);
    syncRegisteredProviderTypes(this.factories.keys());
  }

  /**
   * Register a provider with its factory and metadata.
   * @param providerType The provider type identifier
   * @param factory The factory instance
   * @param metadata Provider capabilities and characteristics
   */
  static registerWithMetadata(
    providerType: string,
    factory: IProviderFactory,
    metadata: IProviderMetadata,
  ): void {
    this.factories.set(providerType, factory);
    this.metadata.set(providerType, metadata);
    syncRegisteredProviderTypes(this.factories.keys());
  }

  /**
   * Get the factory for a specific provider type.
   * @param providerType The provider type to look up
   * @returns The factory instance, or undefined if not registered
   */
  static getFactory(providerType: string): IProviderFactory | undefined {
    return this.factories.get(providerType);
  }

  /**
   * Get metadata for a specific provider.
   * @param providerType The provider type to look up
   * @returns Provider metadata, or undefined if not registered
   */
  static getProviderMetadata(providerType: string): IProviderMetadata | undefined {
    return this.metadata.get(providerType);
  }

  /**
   * Get all registered provider types.
   * @returns Array of all registered provider type strings
   */
  static getSupportedProviders(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * Get providers filtered by cost tier.
   * @param costTier The cost tier to filter by
   * @returns Array of provider names matching the cost tier
   */
  static getProvidersByCostTier(costTier: ProviderCostTier): string[] {
    return Array.from(this.metadata.entries())
      .filter(([, metadata]) => metadata.costTier === costTier)
      .map(([providerType]) => providerType);
  }

  /**
   * Get providers suitable for a specific task type, sorted by cost priority.
   * @param taskType The task type to find providers for
   * @returns Array of provider names sorted from cheapest to most expensive
   */
  static getProvidersForTask(taskType: string): string[] {
    return Array.from(this.metadata.entries())
      .filter(([, metadata]) => metadata.strengths.includes(taskType))
      .sort(([, a], [, b]) => this.costPriority(a.pricingTier) - this.costPriority(b.pricingTier))
      .map(([providerType]) => providerType);
  }

  /**
   * Convert pricing tier to numeric priority for sorting (lower = cheaper).
   * @param pricingTier The pricing tier
   * @returns Numeric priority value
   */
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

  /**
   * Get all registered providers with their metadata.
   * @returns Array of provider info objects with factory and metadata
   */
  static getAllProviders(): Array<{ factory: IProviderFactory; metadata: IProviderMetadata }> {
    return Array.from(this.metadata.entries()).map(([providerType, metadata]) => ({
      factory: this.factories.get(providerType)!,
      metadata,
    }));
  }

  /**
   * Clear all registered factories and metadata.
   * Primarily used for testing to ensure test isolation.
   */
  static clear(): void {
    this.factories.clear();
    this.metadata.clear();
    syncRegisteredProviderTypes([]);
  }
}
