/**
 * @module LlamaPackageProviderFactory
 * @path packages/ai-ollama/src/llama_factory.ts
 * @description Factory for creating Llama provider instances from the @exaix/ai-ollama package.
 * @architectural-layer AI
 * @related-files [packages/ai-ollama/src/llama_provider.ts, packages/ai/src/factories/llama_factory.ts]
 */

import { AbstractProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import type { IModelProvider, IResolvedProviderOptions } from "@exaix/ai/types.ts";
import { LlamaProvider } from "./llama_provider.ts";

export class LlamaProviderFactory extends AbstractProviderFactory {
  async create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    return await new LlamaProvider({
      model: options.model,
      endpoint: options.baseUrl,
    });
  }
}
