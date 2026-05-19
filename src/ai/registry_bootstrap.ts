/**
 * @module AIRegistryBootstrap
 * @path src/ai/registry_bootstrap.ts
 * @description Root composition bootstrap for registering extracted concrete AI providers.
 * @architectural-layer Application
 * @related-files [packages/ai/src/provider_factory.ts, src/services/request/request_processor.ts]
 */

import { initializeRegistry, type IProviderMetadata, ProviderRegistry, setProviderRegistryBootstrap } from "@exaix/ai";
import { PricingTier } from "@exaix/core";
import { ANTHROPIC_PROVIDER_METADATA, AnthropicProviderFactory, PROVIDER_ANTHROPIC } from "@exaix/ai-anthropic";
import { GOOGLE_PROVIDER_METADATA, GoogleProviderFactory, PROVIDER_GOOGLE } from "@exaix/ai-google";
import { OLLAMA_PROVIDER_METADATA, OllamaProviderFactory, PROVIDER_OLLAMA } from "@exaix/ai-ollama";
import { OPENAI_PROVIDER_METADATA, OpenAIProviderFactory, PROVIDER_OPENAI } from "@exaix/ai-openai";

function registerConcreteProviders(): void {
  const supported = ProviderRegistry.getSupportedProviders();

  if (!supported.includes(PROVIDER_OLLAMA)) {
    const ollamaMetadata: IProviderMetadata = {
      name: OLLAMA_PROVIDER_METADATA.name,
      description: OLLAMA_PROVIDER_METADATA.description,
      capabilities: [...OLLAMA_PROVIDER_METADATA.capabilities],
      costTier: OLLAMA_PROVIDER_METADATA.costTier,
      pricingTier: PricingTier.LOCAL,
      strengths: [...OLLAMA_PROVIDER_METADATA.strengths],
    };
    ProviderRegistry.registerWithMetadata(PROVIDER_OLLAMA, new OllamaProviderFactory(), ollamaMetadata);
  }

  if (!supported.includes(PROVIDER_ANTHROPIC)) {
    const anthropicMetadata: IProviderMetadata = {
      name: ANTHROPIC_PROVIDER_METADATA.name,
      description: ANTHROPIC_PROVIDER_METADATA.description,
      capabilities: [...ANTHROPIC_PROVIDER_METADATA.capabilities],
      costTier: ANTHROPIC_PROVIDER_METADATA.costTier,
      pricingTier: PricingTier.HIGH,
      strengths: [...ANTHROPIC_PROVIDER_METADATA.strengths],
    };
    ProviderRegistry.registerWithMetadata(
      PROVIDER_ANTHROPIC,
      new AnthropicProviderFactory(),
      anthropicMetadata,
    );
  }

  if (!supported.includes(PROVIDER_OPENAI)) {
    const openaiMetadata: IProviderMetadata = {
      name: OPENAI_PROVIDER_METADATA.name,
      description: OPENAI_PROVIDER_METADATA.description,
      capabilities: [...OPENAI_PROVIDER_METADATA.capabilities],
      costTier: OPENAI_PROVIDER_METADATA.costTier,
      pricingTier: PricingTier.MEDIUM,
      strengths: [...OPENAI_PROVIDER_METADATA.strengths],
    };
    ProviderRegistry.registerWithMetadata(
      PROVIDER_OPENAI,
      new OpenAIProviderFactory(),
      openaiMetadata,
    );
  }

  if (!supported.includes(PROVIDER_GOOGLE)) {
    const googleMetadata: IProviderMetadata = {
      name: GOOGLE_PROVIDER_METADATA.name,
      description: GOOGLE_PROVIDER_METADATA.description,
      capabilities: [...GOOGLE_PROVIDER_METADATA.capabilities],
      costTier: GOOGLE_PROVIDER_METADATA.costTier,
      pricingTier: PricingTier.LOW,
      strengths: [...GOOGLE_PROVIDER_METADATA.strengths],
    };
    ProviderRegistry.registerWithMetadata(
      PROVIDER_GOOGLE,
      new GoogleProviderFactory(),
      googleMetadata,
    );
  }
}

setProviderRegistryBootstrap(registerConcreteProviders);

export function bootstrapProviderRegistry(): void {
  initializeRegistry();
  registerConcreteProviders();
}
