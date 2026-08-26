/**
 * @module AIRegistryBootstrap
 * @path apps/common/registry_bootstrap.ts
 * @description Root composition bootstrap for registering extracted concrete AI providers.
 * @architectural-layer Application
 * @related-files [packages/ai/src/provider_factory.ts, packages/request/src/processor.ts]
 */

import { initializeRegistry, type IProviderMetadata, ProviderRegistry, setProviderRegistryBootstrap } from "@exaix/ai";
import { PricingTier, ProviderDefaultsRegistry } from "@exaix/core";
import { SessionToolSchema } from "@exaix/schemas/session_delegate.ts";
import {
  ANTHROPIC_DEFAULTS,
  ANTHROPIC_PROVIDER_METADATA,
  AnthropicProviderFactory,
  PROVIDER_ANTHROPIC,
} from "@exaix/ai-anthropic";
import { GOOGLE_DEFAULTS, GOOGLE_PROVIDER_METADATA, GoogleProviderFactory, PROVIDER_GOOGLE } from "@exaix/ai-google";
import {
  OPENROUTER_DEFAULTS,
  OPENROUTER_PROVIDER_METADATA,
  OpenRouterProviderFactory,
  PROVIDER_OPENROUTER,
} from "@exaix/ai-openrouter";
import { OLLAMA_DEFAULTS, OLLAMA_PROVIDER_METADATA, OllamaProviderFactory, PROVIDER_OLLAMA } from "@exaix/ai-ollama";
import { OPENAI_DEFAULTS, OPENAI_PROVIDER_METADATA, OpenAIProviderFactory, PROVIDER_OPENAI } from "@exaix/ai-openai";
import {
  CLAUDE_CLI_DEFAULTS,
  CLAUDE_CLI_PROVIDER_METADATA,
  CliDelegateProviderFactory,
  CODEX_CLI_DEFAULTS,
  CODEX_CLI_PROVIDER_METADATA,
  OPENCODE_CLI_DEFAULTS,
  OPENCODE_CLI_PROVIDER_METADATA,
  PROVIDER_CLAUDE_CLI,
  PROVIDER_CODEX_CLI,
  PROVIDER_OPENCODE_CLI,
} from "@exaix/ai-clidelegate";

function registerConcreteProviders(): void {
  const supported = ProviderRegistry.getSupportedProviders();

  if (!supported.includes(PROVIDER_OLLAMA)) {
    const ollamaMetadata: IProviderMetadata = {
      ...OLLAMA_PROVIDER_METADATA,
      capabilities: [...OLLAMA_PROVIDER_METADATA.capabilities],
      pricingTier: PricingTier.LOCAL,
    };
    ProviderRegistry.registerWithMetadata(PROVIDER_OLLAMA, new OllamaProviderFactory(), ollamaMetadata);
  }

  if (!supported.includes(PROVIDER_ANTHROPIC)) {
    const anthropicMetadata: IProviderMetadata = {
      ...ANTHROPIC_PROVIDER_METADATA,
      capabilities: [...ANTHROPIC_PROVIDER_METADATA.capabilities],
      pricingTier: PricingTier.HIGH,
      supportsNativeTools: true,
    };
    ProviderRegistry.registerWithMetadata(
      PROVIDER_ANTHROPIC,
      new AnthropicProviderFactory(),
      anthropicMetadata,
    );
  }

  if (!supported.includes(PROVIDER_OPENAI)) {
    const openaiMetadata: IProviderMetadata = {
      ...OPENAI_PROVIDER_METADATA,
      capabilities: [...OPENAI_PROVIDER_METADATA.capabilities],
      pricingTier: PricingTier.MEDIUM,
      // Phase 153 Step 2: OpenAIProvider.attemptGenerate() now serializes
      // IModelOptions.tools/toolChoice into real tools[]/tool_choice request fields.
      supportsNativeTools: true,
    };
    ProviderRegistry.registerWithMetadata(
      PROVIDER_OPENAI,
      new OpenAIProviderFactory(),
      openaiMetadata,
    );
  }

  if (!supported.includes(PROVIDER_GOOGLE)) {
    const googleMetadata: IProviderMetadata = {
      ...GOOGLE_PROVIDER_METADATA,
      capabilities: [...GOOGLE_PROVIDER_METADATA.capabilities],
      pricingTier: PricingTier.LOW,
      // Phase 153 Step 3: GoogleProvider.attemptGenerate() now serializes
      // IModelOptions.tools/toolChoice into real tools[]/toolConfig request fields.
      supportsNativeTools: true,
    };
    ProviderRegistry.registerWithMetadata(
      PROVIDER_GOOGLE,
      new GoogleProviderFactory(),
      googleMetadata,
    );
  }

  // OpenRouter ships in Solo (all editions) per edition decision D5b/D-providers (2026-06-13):
  // a BYO-key, independently-free aggregator — gating it adds no value.
  if (!supported.includes(PROVIDER_OPENROUTER)) {
    const openrouterMetadata: IProviderMetadata = {
      ...OPENROUTER_PROVIDER_METADATA,
      capabilities: [...OPENROUTER_PROVIDER_METADATA.capabilities],
      pricingTier: PricingTier.MEDIUM,
      // Phase 135 Step 4 (§5.7.2): OpenRouter is an aggregator reseller — the native
      // admission path and the native_first route policy read this flag.
      isAggregator: true,
      // Phase 153 Step 4: registered true at the PROVIDER level, not per-model. OpenRouter
      // routes to many underlying models, not all of which support tool-calling (see
      // supported_parameters=tools filtering on /api/v1/models, official docs). This phase
      // does not add per-model capability detection — a config pointing OpenRouter at a
      // tool-incapable model with native_tools_enabled will surface as an OpenRouter-side
      // API error, not a silent Exaix-side failure. Known limitation (Risks R3), not
      // silently unhandled.
      supportsNativeTools: true,
    };
    ProviderRegistry.registerWithMetadata(
      PROVIDER_OPENROUTER,
      new OpenRouterProviderFactory(),
      openrouterMetadata,
    );
  }

  // Headless CLI providers (phase-140, codex added phase-166): drive claude/opencode/codex
  // subprocesses so planning/analysis calls also bill against a subscription instead of a
  // metered API key, matching CliDelegateStrategy's auth posture for the code-editing step.
  if (!supported.includes(PROVIDER_CLAUDE_CLI)) {
    const claudeCliMetadata: IProviderMetadata = {
      ...CLAUDE_CLI_PROVIDER_METADATA,
      capabilities: [...CLAUDE_CLI_PROVIDER_METADATA.capabilities],
      pricingTier: PricingTier.LOCAL,
    };
    ProviderRegistry.registerWithMetadata(
      PROVIDER_CLAUDE_CLI,
      new CliDelegateProviderFactory(SessionToolSchema.enum["claude-code"]),
      claudeCliMetadata,
    );
  }

  if (!supported.includes(PROVIDER_OPENCODE_CLI)) {
    const opencodeCliMetadata: IProviderMetadata = {
      ...OPENCODE_CLI_PROVIDER_METADATA,
      capabilities: [...OPENCODE_CLI_PROVIDER_METADATA.capabilities],
      pricingTier: PricingTier.LOCAL,
    };
    ProviderRegistry.registerWithMetadata(
      PROVIDER_OPENCODE_CLI,
      new CliDelegateProviderFactory(SessionToolSchema.enum.opencode),
      opencodeCliMetadata,
    );
  }

  if (!supported.includes(PROVIDER_CODEX_CLI)) {
    const codexCliMetadata: IProviderMetadata = {
      ...CODEX_CLI_PROVIDER_METADATA,
      capabilities: [...CODEX_CLI_PROVIDER_METADATA.capabilities],
      pricingTier: PricingTier.LOCAL,
    };
    ProviderRegistry.registerWithMetadata(
      PROVIDER_CODEX_CLI,
      new CliDelegateProviderFactory(SessionToolSchema.enum.codex),
      codexCliMetadata,
    );
  }
}

function registerProviderDefaults(): void {
  ProviderDefaultsRegistry.register(PROVIDER_OLLAMA, OLLAMA_DEFAULTS);
  ProviderDefaultsRegistry.register(PROVIDER_ANTHROPIC, ANTHROPIC_DEFAULTS);
  ProviderDefaultsRegistry.register(PROVIDER_OPENAI, OPENAI_DEFAULTS);
  ProviderDefaultsRegistry.register(PROVIDER_GOOGLE, GOOGLE_DEFAULTS);
  // OpenRouter is Solo (all editions) — see D5b/D-providers.
  ProviderDefaultsRegistry.register(PROVIDER_OPENROUTER, OPENROUTER_DEFAULTS);
  ProviderDefaultsRegistry.register(PROVIDER_CLAUDE_CLI, CLAUDE_CLI_DEFAULTS);
  ProviderDefaultsRegistry.register(PROVIDER_OPENCODE_CLI, OPENCODE_CLI_DEFAULTS);
  ProviderDefaultsRegistry.register(PROVIDER_CODEX_CLI, CODEX_CLI_DEFAULTS);
}

setProviderRegistryBootstrap(registerConcreteProviders);

export function bootstrapProviderRegistry(): void {
  initializeRegistry();
  registerConcreteProviders();
  registerProviderDefaults();
}
