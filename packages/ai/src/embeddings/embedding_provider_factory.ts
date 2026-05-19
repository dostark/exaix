/**
 * @module EmbeddingProviderFactory
 * @path src/ai/embeddings/embedding_provider_factory.ts
 * @description Factory function that creates IEmbeddingProvider instances
 * from a discriminated config union. Routes to the correct concrete
 * provider (Ollama, OpenAI, llama.cpp) based on the provider field.
 * @architectural-layer AI
 * @dependencies [src/ai/embeddings/embedding_provider.ts, src/ai/embeddings/embedding_errors.ts, src/ai/providers/ollama_embedding_client.ts]
 * @related-files ["packages/core/src/types/i_memory_embedding_service.ts"]
 */

import type { IEmbeddingProvider } from "./embedding_provider.ts";
import { EmbeddingError } from "./embedding_errors.ts";
import { type IOllamaEmbeddingConfig, OllamaEmbeddingClient } from "@exaix/ai-ollama";
import { type IOpenAIEmbeddingConfig, OpenAIEmbeddingClient } from "@exaix/ai-openai";
import { type ILlamaCppEmbeddingConfig, LlamaCppEmbeddingClient } from "../providers/llamacpp_embedding_client.ts";

/**
 * Discriminated union of all embedding provider configs.
 */
export type IEmbeddingProviderConfig =
  | ({ provider: "ollama" } & IOllamaEmbeddingConfig)
  | ({ provider: "openai" } & IOpenAIEmbeddingConfig)
  | ({ provider: "llamacpp" } & ILlamaCppEmbeddingConfig);

/**
 * Create an IEmbeddingProvider from discriminated config.
 * @param config - Provider-specific config with a `provider` discriminator.
 * @returns Concrete IEmbeddingProvider instance.
 * @throws EmbeddingError if the provider is unknown.
 */
export function createEmbeddingProvider(config: IEmbeddingProviderConfig): IEmbeddingProvider {
  switch (config.provider) {
    case "ollama":
      return new OllamaEmbeddingClient(config);
    case "openai":
      return new OpenAIEmbeddingClient(config);
    case "llamacpp":
      return new LlamaCppEmbeddingClient(config);
    default:
      throw new EmbeddingError(
        "UNKNOWN_PROVIDER",
        `Unknown embedding provider: ${(config as { provider: string }).provider}`,
      );
  }
}
