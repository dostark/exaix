/**
 * @module ImemoryEmbeddingService
 * @path src/shared/interfaces/i_memory_embedding_service.ts
 * @description Module for ImemoryEmbeddingService.
 * @architectural-layer Shared
 * * @related-files [src/shared/schemas/memory_bank.ts]
 */

import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import type { IEmbeddingSearchResult } from "../types/memory.ts";

export interface IMemoryEmbeddingService {
  /**
   * Initialize the embedding storage and manifest.
   */
  initializeManifest(): Promise<void>;

  /**
   * Generate and store an embedding for a learning entry.
   */
  embedLearning(learning: ILearning): Promise<void>;

  /**
   * Search for similar learnings using embedding similarity.
   */
  searchByEmbedding(
    query: string,
    options?: { limit?: number; threshold?: number },
  ): Promise<IEmbeddingSearchResult[]>;

  /**
   * Get the raw embedding vector for a learning.
   */
  getEmbedding(id: string): Promise<number[] | null>;

  /**
   * Delete embedding data for a learning.
   */
  deleteEmbedding(id: string): Promise<void>;

  /**
   * Get metadata about the embedding index.
   */
  getStats(): Promise<{ total: number; generated_at: string }>;
}
