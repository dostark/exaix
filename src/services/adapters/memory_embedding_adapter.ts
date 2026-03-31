/**
 * @module MemoryEmbeddingAdapter
 * @path src/services/adapters/memory_embedding_adapter.ts
 * @description Adapter for MemoryEmbeddingService that satisfies the IMemoryEmbeddingService interface.
 * @architectural-layer Services/Adapters
 * * @related-files [src/services/memory_embedding.ts, src/shared/interfaces/i_memory_embedding_service.ts]
 */

import type { IMemoryEmbeddingService } from "../../shared/interfaces/i_memory_embedding_service.ts";
import type { MemoryEmbeddingService } from "../memory/memory_embedding.ts";
import type { ILearning } from "../../shared/schemas/memory_bank.ts";
import type { IEmbeddingSearchResult } from "../../shared/types/memory.ts";

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
