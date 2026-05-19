/**
 * @module OllamaPackageProviderFactory
 * @path packages/ai-ollama/src/ollama_factory.ts
 * @description Factory for creating Ollama provider instances from the @exaix/ai-ollama package.
 * @architectural-layer AI
 * @related-files [packages/ai-ollama/src/ollama_provider.ts, packages/ai/src/factories/ollama_factory.ts]
 */

import { AbstractProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import type { IModelProvider, IResolvedProviderOptions } from "@exaix/ai/types.ts";
import { PROVIDER_OLLAMA } from "./constants.ts";
import { OllamaProvider } from "./ollama_provider.ts";

export class OllamaProviderFactory extends AbstractProviderFactory {
  async create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    return await new OllamaProvider({
      id: options.id ?? `${PROVIDER_OLLAMA}-${options.model}`,
      model: options.model,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
    });
  }
}
