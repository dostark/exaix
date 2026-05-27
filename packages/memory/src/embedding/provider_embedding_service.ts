/**
 * @module ProviderEmbeddingService
 * @path packages/memory/src/embedding/provider_embedding_service.ts
 * @description IMemoryEmbeddingService implementation backed by any
 * IEmbeddingProvider. Stores embedding vectors as JSON files alongside
 * an LRU cache for duplicate input deduplication.
 * @architectural-layer Services
 * @ungrounded
 * @related-files [packages/memory/src/embedding/memory_embedding.ts, packages/core/src/types/i_memory_embedding_service.ts]
 */

import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import type { Config } from "@exaix/schemas/config.ts";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import type { IEmbeddingSearchResult, IMemoryCostRouter } from "@exaix/core/types";
import type { IEmbeddingProvider } from "@exaix/ai";
import type { IMemoryEmbeddingService } from "@exaix/core/types";
import { HnswVectorIndex } from "./vector_index.ts";

const EMBEDDING_LRU_CACHE_MAX_ENTRIES = 512;

/**
 * Estimated cost per embedding API call in USD.
 * Based on ~100 tokens per query at ~$0.002/1K tokens.
 */
const ESTIMATED_EMBED_COST_USD = 0.0002;

interface IEmbeddingFile {
  id: string;
  title: string;
  text: string;
  vector: number[];
  created_at: string;
}

interface IManifestEntry {
  id: string;
  title: string;
  embeddingFile: string;
}

interface IEmbeddingManifest {
  generated_at: string;
  index: IManifestEntry[];
}

class EmbeddingLruCache {
  private entries = new Map<string, number[]>();

  get size(): number {
    return this.entries.size;
  }

  get(key: string): number[] | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key)!;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: number[]): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= EMBEDDING_LRU_CACHE_MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.set(key, value);
  }
}

/**
 * File-backed embedding service that delegates vector generation to any
 * IEmbeddingProvider. Stores vectors as JSON files with a manifest index.
 */
export class ProviderEmbeddingService implements IMemoryEmbeddingService {
  private embeddingsDir: string;
  private manifestPath: string;
  private cache: EmbeddingLruCache;
  private hnsw: HnswVectorIndex;
  private indexBuilt = false;

  constructor(
    private config: Config,
    private provider: IEmbeddingProvider,
    private costRouter?: IMemoryCostRouter,
  ) {
    this.embeddingsDir = join(config.system.root, config.paths.memory, "Index", "embeddings");
    this.manifestPath = join(this.embeddingsDir, "manifest.json");
    this.cache = new EmbeddingLruCache();
    this.hnsw = new HnswVectorIndex();
  }

  async initializeManifest(): Promise<void> {
    await ensureDir(this.embeddingsDir);

    if (!await exists(this.manifestPath)) {
      const manifest: IEmbeddingManifest = {
        generated_at: new Date().toISOString(),
        index: [],
      };
      await Deno.writeTextFile(this.manifestPath, JSON.stringify(manifest, null, 2));
    }
  }

  async embedLearning(learning: ILearning): Promise<void> {
    await this.initializeManifest();

    // Check cost router before calling the embedding provider.
    // When remote operations are not allowed (budget exhausted), skip
    // embedding — the learning is stored text-only and can be searched
    // via keyword fallback.
    const remoteAllowed = this.costRouter ? await this.costRouter.isRemoteAllowed() : true;
    if (!remoteAllowed) return;

    const text = `${learning.title} ${learning.description}`;
    const vector = await this.embedText(text);

    // Record the estimated cost of this embedding operation
    if (this.costRouter) {
      await this.costRouter.recordOperation(ESTIMATED_EMBED_COST_USD);
    }

    const embeddingFile: IEmbeddingFile = {
      id: learning.id,
      title: learning.title,
      text,
      vector,
      created_at: new Date().toISOString(),
    };

    const embeddingPath = join(this.embeddingsDir, `${learning.id}.json`);
    await Deno.writeTextFile(embeddingPath, JSON.stringify(embeddingFile, null, 2));

    await this.updateManifest(learning.id, learning.title, embeddingPath);

    this.hnsw.insert(learning.id, vector);
    this.indexBuilt = true;
  }

  async searchByEmbedding(
    query: string,
    options?: { limit?: number; threshold?: number },
  ): Promise<IEmbeddingSearchResult[]> {
    const manifest = await this.loadManifest();
    if (manifest.index.length === 0) return [];

    // Check cost router before calling the embedding provider.
    // When remote operations are not allowed (budget exhausted), return
    // empty results so the caller falls through to free keyword/local search.
    const remoteAllowed = this.costRouter ? await this.costRouter.isRemoteAllowed() : true;
    if (!remoteAllowed) return [];

    const queryVector = await this.embedText(query);
    const limit = options?.limit ?? 10;
    const threshold = options?.threshold ?? 0.0;

    // Record the estimated cost of this embedding query
    if (this.costRouter) {
      await this.costRouter.recordOperation(ESTIMATED_EMBED_COST_USD);
    }

    // Ensure HNSW index is built from stored embeddings
    await this.ensureIndex(manifest);

    // Search via HNSW index (O(log N))
    const indexResults = this.hnsw.search(queryVector, limit);

    // Load metadata for top-K results only (O(K) disk reads)
    const results: IEmbeddingSearchResult[] = [];
    for (const ir of indexResults) {
      if (ir.similarity < threshold) continue;
      const embeddingPath = join(this.embeddingsDir, `${ir.id}.json`);
      try {
        const content = await Deno.readTextFile(embeddingPath);
        const embedding: IEmbeddingFile = JSON.parse(content) as IEmbeddingFile;
        results.push({
          id: embedding.id,
          title: embedding.title,
          summary: embedding.text.substring(0, 200),
          similarity: ir.similarity,
        });
      } catch {
        continue;
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  async getEmbedding(id: string): Promise<number[] | null> {
    const manifest = await this.loadManifest();
    const entry = manifest.index.find((e) => e.id === id);
    if (!entry) return null;

    try {
      const fileContent = await Deno.readTextFile(entry.embeddingFile);
      const embedding: IEmbeddingFile = JSON.parse(fileContent) as IEmbeddingFile;
      return embedding.vector;
    } catch {
      return null;
    }
  }

  async deleteEmbedding(id: string): Promise<void> {
    const manifest = await this.loadManifest();
    const entryIndex = manifest.index.findIndex((e) => e.id === id);
    if (entryIndex === -1) return;

    const entry = manifest.index[entryIndex];

    try {
      await Deno.remove(entry.embeddingFile);
    } catch {
      // File already gone — continue
    }

    manifest.index.splice(entryIndex, 1);
    manifest.generated_at = new Date().toISOString();
    await this.saveManifest(manifest);

    this.hnsw.delete(id);
  }

  async getStats(): Promise<{ total: number; generated_at: string }> {
    const manifest = await this.loadManifest();
    return {
      total: manifest.index.length,
      generated_at: manifest.generated_at,
    };
  }

  private async embedText(text: string): Promise<number[]> {
    const cached = this.cache.get(text);
    if (cached) return cached;

    const vectors = await this.provider.embed([text]);
    if (vectors.length === 0 || vectors[0].length === 0) {
      throw new Error("Embedding provider returned empty vector");
    }

    const vector = vectors[0];
    this.cache.set(text, vector);
    return vector;
  }

  private async loadManifest(): Promise<IEmbeddingManifest> {
    await this.initializeManifest();
    const content = await Deno.readTextFile(this.manifestPath);
    return JSON.parse(content) as IEmbeddingManifest;
  }

  private async saveManifest(manifest: IEmbeddingManifest): Promise<void> {
    await Deno.writeTextFile(this.manifestPath, JSON.stringify(manifest, null, 2));
  }

  private async updateManifest(id: string, title: string, embeddingFile: string): Promise<void> {
    const manifest = await this.loadManifest();
    manifest.index.push({ id, title, embeddingFile });
    manifest.generated_at = new Date().toISOString();
    await this.saveManifest(manifest);
  }

  private async ensureIndex(manifest: IEmbeddingManifest): Promise<void> {
    if (this.indexBuilt) return;

    const vectors = new Map<string, number[]>();
    for (const entry of manifest.index) {
      try {
        const content = await Deno.readTextFile(entry.embeddingFile);
        const embedding: IEmbeddingFile = JSON.parse(content) as IEmbeddingFile;
        vectors.set(entry.id, embedding.vector);
      } catch {
        continue;
      }
    }

    this.hnsw.rebuildFromVectors(vectors);
    this.indexBuilt = true;
  }
}
