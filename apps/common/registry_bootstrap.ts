/**
 * @module AIRegistryBootstrap
 * @path apps/common/registry_bootstrap.ts
 * @description Root composition bootstrap for registering extracted concrete AI providers.
 * @architectural-layer Application
 * @related-files [packages/ai/src/provider_factory.ts, packages/request/src/processor.ts]
 */

import { initializeRegistry, type IProviderMetadata, ProviderRegistry, setProviderRegistryBootstrap } from "@exaix/ai";
import { PricingTier, ProviderDefaultsRegistry } from "@exaix/core";
import {
  ANTHROPIC_DEFAULTS,
  ANTHROPIC_PROVIDER_METADATA,
  AnthropicProviderFactory,
  PROVIDER_ANTHROPIC,
} from "@exaix/ai-anthropic";
import { GOOGLE_DEFAULTS, GOOGLE_PROVIDER_METADATA, GoogleProviderFactory, PROVIDER_GOOGLE } from "@exaix/ai-google";
import { PROVIDER_VERTEX, VERTEX_DEFAULTS, VERTEX_PROVIDER_METADATA, VertexProviderFactory } from "@exaix/ai-vertex";
import {
  OPENROUTER_DEFAULTS,
  OPENROUTER_PROVIDER_METADATA,
  OpenRouterProviderFactory,
  PROVIDER_OPENROUTER,
} from "@exaix/ai-openrouter";
import { OLLAMA_DEFAULTS, OLLAMA_PROVIDER_METADATA, OllamaProviderFactory, PROVIDER_OLLAMA } from "@exaix/ai-ollama";
import { OPENAI_DEFAULTS, OPENAI_PROVIDER_METADATA, OpenAIProviderFactory, PROVIDER_OPENAI } from "@exaix/ai-openai";

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

  if (!supported.includes(PROVIDER_VERTEX)) {
    const vertexMetadata: IProviderMetadata = {
      name: VERTEX_PROVIDER_METADATA.name,
      description: VERTEX_PROVIDER_METADATA.description,
      capabilities: [...VERTEX_PROVIDER_METADATA.capabilities],
      costTier: VERTEX_PROVIDER_METADATA.costTier,
      pricingTier: PricingTier.MEDIUM,
      strengths: [...VERTEX_PROVIDER_METADATA.strengths],
    };
    ProviderRegistry.registerWithMetadata(
      PROVIDER_VERTEX,
      new VertexProviderFactory(),
      vertexMetadata,
    );
  }

  if (!supported.includes(PROVIDER_OPENROUTER)) {
    const openrouterMetadata: IProviderMetadata = {
      name: OPENROUTER_PROVIDER_METADATA.name,
      description: OPENROUTER_PROVIDER_METADATA.description,
      capabilities: [...OPENROUTER_PROVIDER_METADATA.capabilities],
      costTier: OPENROUTER_PROVIDER_METADATA.costTier,
      pricingTier: PricingTier.MEDIUM,
      strengths: [...OPENROUTER_PROVIDER_METADATA.strengths],
    };
    ProviderRegistry.registerWithMetadata(
      PROVIDER_OPENROUTER,
      new OpenRouterProviderFactory(),
      openrouterMetadata,
    );
  }
}

function registerProviderDefaults(): void {
  ProviderDefaultsRegistry.register(PROVIDER_OLLAMA, OLLAMA_DEFAULTS);
  ProviderDefaultsRegistry.register(PROVIDER_ANTHROPIC, ANTHROPIC_DEFAULTS);
  ProviderDefaultsRegistry.register(PROVIDER_OPENAI, OPENAI_DEFAULTS);
  ProviderDefaultsRegistry.register(PROVIDER_GOOGLE, GOOGLE_DEFAULTS);
  ProviderDefaultsRegistry.register(PROVIDER_VERTEX, VERTEX_DEFAULTS);
  ProviderDefaultsRegistry.register(PROVIDER_OPENROUTER, OPENROUTER_DEFAULTS);
}

setProviderRegistryBootstrap(registerConcreteProviders);

export function bootstrapProviderRegistry(): void {
  initializeRegistry();
  registerConcreteProviders();
  registerProviderDefaults();
}
