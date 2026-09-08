/**
 * @module ImemoryEmbeddingService
 * @path packages/core/src/types/i_memory_embedding_service.ts
 * @description Module for ImemoryEmbeddingService.
 * @architectural-layer Shared
 * @related-files [packages/schemas/src/memory_bank.ts]
 */

import type { ILearning } from "@exaix/schemas";

import type { IEmbeddableMemoryEntry, IEmbeddingSearchResult } from "@exaix/core/types";

export interface IMemoryEmbeddingService {
  /**
   * Initialize the embedding storage and manifest.
   */
  initializeManifest(): Promise<void>;

  /**
   * Generate and store an embedding for a learning entry.
   */
  embedLearning(learning: ILearning): Promise<void>;

  /** Embed any embeddable memory entry, keyed by its own id (id / trace_id / `${portal}:overview`); cost-gated and idempotent per key. */
  embed(entry: IEmbeddableMemoryEntry): Promise<void>;

  /** Search by embedding similarity. `allowedIds` restricts candidates to those manifest
   *  identities before ranking (never topK-then-filter); `signal` cancels the query. */
  searchByEmbedding(
    query: string,
    options?: { limit?: number; threshold?: number; allowedIds?: ReadonlySet<string>; signal?: AbortSignal },
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

  /** Only implemented by services with a disk-backed cache; call after a batch of
   *  embedLearning() calls to guarantee persistence. */
  flush?(): Promise<void>;
}
