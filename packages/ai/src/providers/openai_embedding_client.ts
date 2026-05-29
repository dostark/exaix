/**
 * @module OpenAIEmbeddingClient
 * @path packages/ai/src/providers/openai_embedding_client.ts
 * @description IEmbeddingProvider implementation for the OpenAI /embeddings endpoint.
 * Lives in @exaix/ai (not @exaix/ai-openai) to avoid a circular dependency —
 * the factory in this package must instantiate it directly.
 * @architectural-layer AI
 * @ungrounded
 * @dependencies [packages/ai/src/embeddings/embedding_provider.ts, packages/ai/src/embeddings/embedding_errors.ts]
 * @related-files [packages/ai/src/embeddings/embedding_provider_factory.ts]
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
  readonly dimension = 1536;

  constructor(config: IOpenAIEmbeddingConfig) {
    if (!config.apiKey || config.apiKey.length === 0) {
      throw new EmbeddingError("INVALID_CONFIG", "OpenAI API key is required");
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    void texts;
    await Promise.resolve();
    throw new EmbeddingError(
      "EMBEDDING_FAILED",
      "OpenAI embedding client not yet implemented (Step 68.5)",
    );
  }
}
