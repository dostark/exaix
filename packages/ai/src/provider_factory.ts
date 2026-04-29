/**
 * @module ProviderFactory
 * @path src/provider_factory.ts
 * @description Package-local registry initialization for @exaix/ai.
 * @architectural-layer AI
 */
import {
  PROVIDER_ANTHROPIC,
  PROVIDER_ANTHROPIC_CAPABILITIES,
  PROVIDER_ANTHROPIC_DESCRIPTION,
  PROVIDER_ANTHROPIC_STRENGTHS,
  PROVIDER_COST_TIER_FREE,
  PROVIDER_COST_TIER_FREEMIUM,
  PROVIDER_COST_TIER_PAID,
  PROVIDER_GOOGLE,
  PROVIDER_GOOGLE_CAPABILITIES,
  PROVIDER_GOOGLE_DESCRIPTION,
  PROVIDER_GOOGLE_STRENGTHS,
  PROVIDER_MOCK,
  PROVIDER_MOCK_CAPABILITIES,
  PROVIDER_MOCK_DESCRIPTION,
  PROVIDER_MOCK_STRENGTHS,
  PROVIDER_OLLAMA,
  PROVIDER_OLLAMA_CAPABILITIES,
  PROVIDER_OLLAMA_DESCRIPTION,
  PROVIDER_OLLAMA_STRENGTHS,
  PROVIDER_OPENAI,
  PROVIDER_OPENAI_CAPABILITIES,
  PROVIDER_OPENAI_DESCRIPTION,
  PROVIDER_OPENAI_STRENGTHS,
} from "./constants.ts";
import { PricingTier } from "@exaix/core";
import { type IProviderMetadata, ProviderRegistry } from "./provider_registry.ts";
import { AbstractProviderFactory } from "./factories/abstract_provider_factory.ts";

interface ProviderOptions {
  [key: string]: string;
}

class PackageAIPackageProviderFactory extends AbstractProviderFactory<ProviderOptions, object> {
  create(_options: ProviderOptions): Promise<object> {
    return Promise.reject(
      new Error(
        "AI provider creation is not supported through @exaix/ai/provider_factory.ts. Use the root src/ai/provider_factory.ts implementation instead.",
      ),
    );
  }
}

export function initializeRegistry(): void {
  const supported = ProviderRegistry.getSupportedProviders();

  if (!supported.includes(PROVIDER_MOCK)) {
    const mockMetadata: IProviderMetadata = {
      name: PROVIDER_MOCK,
      description: PROVIDER_MOCK_DESCRIPTION,
      capabilities: [...PROVIDER_MOCK_CAPABILITIES],
      costTier: PROVIDER_COST_TIER_FREE,
      pricingTier: PricingTier.FREE,
      strengths: [...PROVIDER_MOCK_STRENGTHS],
    };
    ProviderRegistry.registerWithMetadata(PROVIDER_MOCK, new PackageAIPackageProviderFactory(), mockMetadata);
  }

  if (!supported.includes(PROVIDER_OLLAMA)) {
    const ollamaMetadata: IProviderMetadata = {
      name: PROVIDER_OLLAMA,
      description: PROVIDER_OLLAMA_DESCRIPTION,
      capabilities: [...PROVIDER_OLLAMA_CAPABILITIES],
      costTier: PROVIDER_COST_TIER_FREEMIUM,
      pricingTier: PricingTier.LOCAL,
      strengths: [...PROVIDER_OLLAMA_STRENGTHS],
    };
    ProviderRegistry.registerWithMetadata(PROVIDER_OLLAMA, new PackageAIPackageProviderFactory(), ollamaMetadata);
  }

  if (!supported.includes(PROVIDER_ANTHROPIC)) {
    const anthropicMetadata: IProviderMetadata = {
      name: PROVIDER_ANTHROPIC,
      description: PROVIDER_ANTHROPIC_DESCRIPTION,
      capabilities: [...PROVIDER_ANTHROPIC_CAPABILITIES],
      costTier: PROVIDER_COST_TIER_PAID,
      pricingTier: PricingTier.HIGH,
      strengths: [...PROVIDER_ANTHROPIC_STRENGTHS],
    };
    ProviderRegistry.registerWithMetadata(PROVIDER_ANTHROPIC, new PackageAIPackageProviderFactory(), anthropicMetadata);
  }

  if (!supported.includes(PROVIDER_OPENAI)) {
    const openaiMetadata: IProviderMetadata = {
      name: PROVIDER_OPENAI,
      description: PROVIDER_OPENAI_DESCRIPTION,
      capabilities: [...PROVIDER_OPENAI_CAPABILITIES],
      costTier: PROVIDER_COST_TIER_PAID,
      pricingTier: PricingTier.MEDIUM,
      strengths: [...PROVIDER_OPENAI_STRENGTHS],
    };
    ProviderRegistry.registerWithMetadata(PROVIDER_OPENAI, new PackageAIPackageProviderFactory(), openaiMetadata);
  }

  if (!supported.includes(PROVIDER_GOOGLE)) {
    const googleMetadata: IProviderMetadata = {
      name: PROVIDER_GOOGLE,
      description: PROVIDER_GOOGLE_DESCRIPTION,
      capabilities: [...PROVIDER_GOOGLE_CAPABILITIES],
      costTier: PROVIDER_COST_TIER_PAID,
      pricingTier: PricingTier.LOW,
      strengths: [...PROVIDER_GOOGLE_STRENGTHS],
    };
    ProviderRegistry.registerWithMetadata(PROVIDER_GOOGLE, new PackageAIPackageProviderFactory(), googleMetadata);
  }
}
