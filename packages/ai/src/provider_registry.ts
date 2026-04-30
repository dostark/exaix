/**
 * @module ProviderRegistry
 * @path src/ai/provider_registry.ts
 * @description central registry for all LLM provider factories, managing provider discovery, metadata, and selection logic.
 * @architectural-layer AI
 * @related-files [src/ai/providers.ts, "src/services/agent/agent_runner.ts"]
 */
import { PricingTier, PriorityLevel, type ProviderCostTier } from "@exaix/core";
import type { IProviderFactory } from "./factories/abstract_provider_factory.ts";

export interface IProviderMetadata {
  name: string;
  description: string;
  capabilities: string[];
  costTier: ProviderCostTier;
  freeQuota?: {
    requestsPerDay?: number;
    requestsPerMinute?: number;
    tokensPerMonth?: number;
  };
  pricingTier: PricingTier;
  strengths: string[];
}

export class ProviderRegistry {
  private static factories = new Map<string, IProviderFactory>();
  private static metadata = new Map<string, IProviderMetadata>();

  static register(providerType: string, factory: IProviderFactory): void {
    this.factories.set(providerType, factory);
  }

  static registerWithMetadata(
    providerType: string,
    factory: IProviderFactory,
    metadata: IProviderMetadata,
  ): void {
    this.factories.set(providerType, factory);
    this.metadata.set(providerType, metadata);
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

  static getProvidersForTask(taskType: string): string[] {
    return Array.from(this.metadata.entries())
      .filter(([, metadata]) => metadata.strengths.includes(taskType))
      .sort(([, a], [, b]) => this.costPriority(a.pricingTier) - this.costPriority(b.pricingTier))
      .map(([providerType]) => providerType);
  }

  private static costPriority(pricingTier: PricingTier): number {
    switch (pricingTier) {
      case PricingTier.LOCAL:
        return PriorityLevel.LOCAL;
      case PricingTier.FREE:
        return 1;
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

  static clear(): void {
    this.factories.clear();
    this.metadata.clear();
  }
}
