/**
 * @module LlamaCppEmbeddingClient
 * @path packages/ai/src/providers/llamacpp_embedding_client.ts
 * @description IEmbeddingProvider stub for llama.cpp /embedding endpoint.
 * To be fully implemented in Step 68.6.
 * @architectural-layer AI
 * @ungrounded
 * @dependencies [packages/ai/src/embeddings/embedding_provider.ts, packages/ai/src/embeddings/embedding_errors.ts]
 * @related-files [packages/ai/src/embeddings/embedding_provider_factory.ts]
 */

import type { IEmbeddingProvider } from "../embeddings/embedding_provider.ts";
import { EmbeddingError } from "../embeddings/embedding_errors.ts";

export interface ILlamaCppEmbeddingConfig {
  model?: string;
  baseUrl?: string;
  chunkSize?: number;
}

export class LlamaCppEmbeddingClient implements IEmbeddingProvider {
  readonly providerId = "llamacpp";
  readonly dimension = 768; // nomic-embed-text via llama.cpp

  constructor(_config: ILlamaCppEmbeddingConfig) {
    // Full implementation deferred to Step 68.6
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Stub — full implementation in Step 68.6
    void texts;
    await Promise.resolve();
    throw new EmbeddingError(
      "EMBEDDING_FAILED",
      "llama.cpp embedding client not yet implemented (Step 68.6)",
    );
  }
}
