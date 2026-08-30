/**
 * @module EmbeddingProvider
 * @path packages/ai/src/embeddings/embedding_provider.ts
 * @description Provider-agnostic interface for embedding text inputs into
 * vector representations. Concrete implementations wrap Ollama, OpenAI,
 * llama.cpp, or any other embedding backend.
 * @architectural-layer AI
 * @dependencies [src/shared/constants.ts]
 * @related-files [packages/ai-ollama/src/ollama_embedding_client.ts, packages/ai/src/embeddings/embedding_provider_factory.ts]
 */

/**
 * Provider-agnostic contract for generating embedding vectors.
 * Each concrete implementation handles one backend (Ollama, OpenAI, etc.).
 */
export interface IEmbeddingProvider {
  /** Generates embedding vectors for each input text, in the same order. */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Provider identifier (e.g., "ollama", "openai", "llamacpp").
   */
  readonly providerId: string;

  /** Embedding dimension for the configured model; used to validate vector compatibility. */
  readonly dimension: number;
}
