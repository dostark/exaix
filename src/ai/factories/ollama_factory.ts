/**
 * @module OllamaProviderFactory
 * @path src/ai/factories/ollama_factory.ts
 * @description Factory for creating Ollama provider instances, configured via local endpoints.
 * @architectural-layer AI
 * * @related-files [src/ai/providers/llama_provider.ts]
 */
import { AbstractProviderFactory } from "./abstract_provider_factory.ts";
import { IModelProvider, IResolvedProviderOptions } from "../types.ts";
import { OllamaProvider } from "../providers.ts";

export class OllamaProviderFactory extends AbstractProviderFactory {
  async create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    return await new OllamaProvider({
      id: options.id ?? `ollama-${options.model}`,
      model: options.model,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
    });
  }
}
