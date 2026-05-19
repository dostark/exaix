/**
 * @module OpenAIPackageEmbeddingClient
 * @path packages/ai-openai/src/openai_embedding_client.ts
 * @description OpenAI embedding client owned by the @exaix/ai-openai package.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/openai_embedding_client.ts]
 */

import { EmbeddingError } from "@exaix/ai/embeddings/embedding_errors.ts";
import type { IEmbeddingProvider } from "@exaix/ai/embeddings/embedding_provider.ts";

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
