/**
 * @module ProviderRegistry
 * @path packages/ai/src/provider_registry.ts
 * @description central registry for all LLM provider factories, managing provider discovery, metadata, and selection logic.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers.ts, "packages/execution/src/agent_runner.ts"]
 */
import { type ChatFormat, PricingTier, PriorityLevel, type ProviderCostTier } from "@exaix/core";
import type { IProviderFactory } from "./factories/abstract_provider_factory.ts";
import type { IModelOptions } from "./types.ts";
import type { Opt, Reason } from "@exaix/core/types";

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
  /** Descriptive transport metadata. It does not select an execution format. */
  chatFormat?: ChatFormat;
  /** True only when this provider accepts an invocation-local complete native conversation. */
  supportsNativeConversation?: boolean;
}

/** Returns an exact candidate or the longest `candidate-` prefix. */
export function longestPrefixMatch<T extends string>(
  id: Opt<string, Reason.OptionalContext>,
  candidates: readonly T[],
): T | undefined {
  if (id === undefined) return undefined;
  if ((candidates as readonly string[]).includes(id)) return id as T;
  return candidates
    .filter((candidate) => id.startsWith(`${candidate}-`))
    .reduce<T | undefined>((best, candidate) => !best || candidate.length > best.length ? candidate : best, undefined);
}

/** Rejects invocation-local snapshots unless the registered provider contract accepts them. */
export function assertNoNativeConversation(
  providerId: string,
  options?: Opt<IModelOptions, Reason.OptionalInput>,
): void {
  if (
    options?.nativeConversation &&
    ProviderRegistry.getMetadataForInstance(providerId)?.supportsNativeConversation !== true
  ) {
    throw new Error(`Provider ${providerId} does not support native conversation snapshots`);
  }
}

/** RateLimitedProvider prefixes the wrapped provider id with this string. */
const RATE_LIMITED_ID_PREFIX = /^rate-limited-/;

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

  static getMetadataForInstance(id: Opt<string, Reason.OptionalContext>): IProviderMetadata | undefined {
    const providerType = longestPrefixMatch(id?.replace(RATE_LIMITED_ID_PREFIX, ""), [...this.metadata.keys()]);
    return providerType === undefined ? undefined : this.metadata.get(providerType);
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
