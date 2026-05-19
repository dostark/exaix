/**
 * @module OllamaPackageProviderFactory
 * @path packages/ai-ollama/src/ollama_factory.ts
 * @description Factory for creating Ollama provider instances from the @exaix/ai-ollama package.
 * @architectural-layer AI
 * @related-files [packages/ai-ollama/src/ollama_provider.ts, packages/ai/src/factories/ollama_factory.ts]
 */

import { AbstractProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import type { IModelProvider, IResolvedProviderOptions } from "@exaix/ai/types.ts";
import { LLAMA_MODEL_PATTERN, PROVIDER_OLLAMA } from "./constants.ts";
import { OllamaProvider } from "./ollama_provider.ts";
import { LlamaProvider } from "./llama_provider.ts";

export class OllamaProviderFactory extends AbstractProviderFactory {
  async create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    if (options.model && LLAMA_MODEL_PATTERN.test(options.model)) {
      return await new LlamaProvider({ model: options.model, endpoint: options.baseUrl });
    }
    return await new OllamaProvider({
      id: options.id ?? `${PROVIDER_OLLAMA}-${options.model}`,
      model: options.model,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
    });
  }
}
