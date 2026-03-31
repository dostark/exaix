/**
 * @module LlamaProviderFactory
 * @path src/ai/factories/llama_factory.ts
 * @description Factory for creating Llama (local/Ollama-style) provider instances.
 * @architectural-layer AI
 * * @related-files [src/ai/providers/llama_provider.ts]
 */
import { AbstractProviderFactory } from "./abstract_provider_factory.ts";
import { IModelProvider, IResolvedProviderOptions } from "../types.ts";
import { LlamaProvider } from "../providers/llama_provider.ts";

export class LlamaProviderFactory extends AbstractProviderFactory {
  async create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    return await new LlamaProvider({
      model: options.model,
      endpoint: options.baseUrl,
    });
  }
}
