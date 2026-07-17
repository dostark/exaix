/**
 * @module AnthropicPackageProviderFactory
 * @path packages/ai-anthropic/src/anthropic_factory.ts
 * @description Factory for creating Anthropic provider instances from the @exaix/ai-anthropic package.
 * @architectural-layer AI
 * @related-files [packages/ai-anthropic/src/anthropic_provider.ts, packages/ai-anthropic/src/anthropic_factory.ts]
 */

import { AbstractKeyBasedProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import type { IModelProvider, IResolvedProviderOptions } from "@exaix/ai/types.ts";
import { PROVIDER_ANTHROPIC } from "./constants.ts";
import { AnthropicProvider } from "./anthropic_provider.ts";

export class AnthropicProviderFactory extends AbstractKeyBasedProviderFactory {
  constructor() {
    super("ANTHROPIC_API_KEY");
  }

  async create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    const apiKey = await this.getApiKey(options);

    return new AnthropicProvider({
      apiKey,
      model: options.model,
      id: this.generateId(PROVIDER_ANTHROPIC, options.model, options.id),
      logger: options.logger,
      // Without this, every config-driven provider default (ai_anthropic.max_tokens_default,
      // api_version, ai_endpoints.anthropic, retry/timeout blocks) is silently dead on the
      // factory path — the constructor reads them from options.config.
      config: options.config,
      // resolveOptions computed this from [models.<name>].timeout_ms / env / ai_timeout;
      // dropping it pins every factory-created provider to the 60s package default, which a
      // thinking model's plan-sized generation routinely exceeds.
      timeoutMs: options.timeoutMs,
    });
  }
}
