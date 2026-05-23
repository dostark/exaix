/**
 * @module MemoryEmbeddingAdapter
 * @path apps/common/adapters/memory_embedding_adapter.ts
 * @description Adapter for MemoryEmbeddingService that satisfies the IMemoryEmbeddingService interface.
 * @architectural-layer Services/Adapters
 * @ungrounded
 * @related-files ["packages/memory/src/embedding/memory_embedding.ts", "packages/core/src/types/i_memory_embedding_service.ts"]
 */

import type { IMemoryEmbeddingService } from "@exaix/core/types";
import type { MemoryEmbeddingService } from "@exaix/memory";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import type { IEmbeddingSearchResult } from "@exaix/core/types";

export class MemoryEmbeddingAdapter implements IMemoryEmbeddingService {
  constructor(private inner: MemoryEmbeddingService) {}

  async initializeManifest(): Promise<void> {
    return await this.inner.initializeManifest();
  }

  async embedLearning(learning: ILearning): Promise<void> {
    return await this.inner.embedLearning(learning);
  }

  async searchByEmbedding(
    query: string,
    options?: { limit?: number; threshold?: number },
  ): Promise<IEmbeddingSearchResult[]> {
    return await this.inner.searchByEmbedding(query, options);
  }

  async getEmbedding(id: string): Promise<number[] | null> {
    return await this.inner.getEmbedding(id);
  }

  async deleteEmbedding(id: string): Promise<void> {
    return await this.inner.deleteEmbedding(id);
  }

  async getStats(): Promise<{ total: number; generated_at: string }> {
    return await this.inner.getStats();
  }
}
