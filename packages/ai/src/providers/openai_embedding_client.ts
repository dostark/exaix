/**
 * @module OpenAIEmbeddingClient
 * @path src/ai/providers/openai_embedding_client.ts
 * @description IEmbeddingProvider stub for OpenAI /v1/embeddings.
 * To be fully implemented in Step 68.5.
 * @architectural-layer AI
 * @dependencies [src/ai/embeddings/embedding_provider.ts, src/ai/embeddings/embedding_errors.ts]
 * @related-files [src/ai/embeddings/embedding_provider_factory.ts]
 */

import type { IEmbeddingProvider } from "../embeddings/embedding_provider.ts";
import { EmbeddingError } from "../embeddings/embedding_errors.ts";

export interface IOpenAIEmbeddingConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  chunkSize?: number;
}

export class OpenAIEmbeddingClient implements IEmbeddingProvider {
  readonly providerId = "openai";
  readonly dimension = 1536; // text-embedding-3-small

  constructor(_config: IOpenAIEmbeddingConfig) {
    if (!_config.apiKey || _config.apiKey.length === 0) {
      throw new EmbeddingError("INVALID_CONFIG", "OpenAI API key is required");
    }
    // Full implementation deferred to Step 68.5
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Stub — full implementation in Step 68.5
    void texts;
    await Promise.resolve();
    throw new EmbeddingError(
      "EMBEDDING_FAILED",
      "OpenAI embedding client not yet implemented (Step 68.5)",
    );
  }
}
