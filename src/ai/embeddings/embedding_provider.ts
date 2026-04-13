/**
 * @module EmbeddingProvider
 * @path src/ai/embeddings/embedding_provider.ts
 * @description Provider-agnostic interface for embedding text inputs into
 * vector representations. Concrete implementations wrap Ollama, OpenAI,
 * llama.cpp, or any other embedding backend.
 * @architectural-layer AI
 * @dependencies [src/shared/constants.ts]
 * @related-files [src/ai/providers/ollama_embedding_client.ts, src/ai/embeddings/embedding_provider_factory.ts]
 */

/**
 * Provider-agnostic contract for generating embedding vectors.
 * Each concrete implementation handles one backend (Ollama, OpenAI, etc.).
 */
export interface IEmbeddingProvider {
  /**
   * Generate embedding vectors for one or more input texts.
   * Returns an array of vectors, one per input text, in the same order.
   * @param texts - Array of text strings to embed.
   * @returns Array of embedding vectors (number arrays).
   */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Provider identifier (e.g., "ollama", "openai", "llamacpp").
   */
  readonly providerId: string;

  /**
   * Embedding dimension for the configured model.
   * Used by downstream consumers to validate vector compatibility.
   */
  readonly dimension: number;
}
