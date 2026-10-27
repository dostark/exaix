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

import * as pathBuilders from "@exaix/shared";
import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import type { IEmbeddableMemoryEntry, IEmbeddingSearchResult, IMemoryCostRouter } from "@exaix/core/types";
import type { IEmbeddingProvider } from "@exaix/ai";
import type { IMemoryEmbeddingService } from "@exaix/core/types";
import { HnswVectorIndex } from "./vector_index.ts";
import {
  ensureEmbeddingManifest,
  type IEmbeddingFile,
  type IEmbeddingManifest,
  readEmbeddingSearchResults,
} from "./embedding_storage.ts";
import { OllamaEmbeddingClient } from "@exaix/ai-ollama";
import { computeTextHash, DiskBackedEmbeddingCache } from "./disk_cache.ts";
import { chunkEmbeddingId, embeddableId, embeddableTextChunks, embeddableTitle } from "./embeddable_entry.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { MemoryCostOperation, MemoryType } from "@exaix/core";

const EMBEDDING_CACHE_MAX_ENTRIES = 512;

/** Estimated cost per embedding API call in USD (~100 tokens at ~$0.002/1K tokens). */
const ESTIMATED_EMBED_COST_USD = 0.0002;

/** File-backed embedding service delegating vector generation to an IEmbeddingProvider. */
export class ProviderEmbeddingService implements IMemoryEmbeddingService {
  private embeddingsDir: string;
  private manifestPath: string;
  private cache: DiskBackedEmbeddingCache;
  private cacheReady = false;
  private hnsw: HnswVectorIndex;
  private indexBuilt = false;

  constructor(
    private config: Config,
    private provider: IEmbeddingProvider = new OllamaEmbeddingClient(),
    private costRouter?: Opt<IMemoryCostRouter, Reason.OptionalDependency>,
  ) {
    this.embeddingsDir = pathBuilders.memoryIndexPath(join(config.system.root, config.paths.memory), "embeddings");
    this.manifestPath = join(this.embeddingsDir, "manifest.json");
    const cacheDir = join(config.system.root, config.paths.runtime, "cache", "embeddings");
    this.cache = new DiskBackedEmbeddingCache(cacheDir, EMBEDDING_CACHE_MAX_ENTRIES);
    this.hnsw = new HnswVectorIndex();
  }

  initializeManifest(): Promise<void> {
    return ensureEmbeddingManifest(this.embeddingsDir, this.manifestPath);
  }

  async embedLearning(learning: ILearning): Promise<void> {
    await this.embed({ kind: MemoryType.LEARNING, learning });
  }

  async embed(entry: IEmbeddableMemoryEntry): Promise<void> {
    await this.initializeManifest();

    // Skip embedding if remote operations are disallowed by budget exhausted state.
    const remoteAllowed = this.costRouter ? await this.costRouter.isRemoteAllowed() : true;
    if (!remoteAllowed) return;

    const chunks = embeddableTextChunks(entry);
    if (chunks.length === 0) return;

    const baseId = embeddableId(entry);
    const title = embeddableTitle(entry);

    for (let index = 0; index < chunks.length; index++) {
      const id = chunkEmbeddingId(baseId, index);
      const vector = await this.embedText(chunks[index]);

      // Record the estimated cost of this embedding operation
      if (this.costRouter) {
        await this.costRouter.recordOperation(ESTIMATED_EMBED_COST_USD, MemoryCostOperation.EMBEDDING);
      }

      const embeddingFile: IEmbeddingFile = {
        id,
        title,
        text: chunks[index],
        vector,
        created_at: new Date().toISOString(),
        kind: entry.kind,
      };

      const embeddingPath = join(this.embeddingsDir, `${id}.json`);
      await Deno.writeTextFile(embeddingPath, JSON.stringify(embeddingFile, null, 2));

      await this.upsertManifest(id, title, embeddingPath);

      this.hnsw.insert(id, vector);
      this.indexBuilt = true;
    }

    // A re-embed with fewer chunks (e.g. a shrunken overview) must not leave stale entries behind.
    await this.deleteChunkEntriesBeyond(baseId, chunks.length);
  }

  async searchByEmbedding(
    query: string,
    options?: Opt<
      { limit?: number; threshold?: number; allowedIds?: ReadonlySet<string>; signal?: AbortSignal },
      Reason.ExecutionConfig
    >,
  ): Promise<IEmbeddingSearchResult[]> {
    if (options?.signal?.aborted) return [];

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
      await this.costRouter.recordOperation(ESTIMATED_EMBED_COST_USD, MemoryCostOperation.EMBEDDING);
    }

    // Ensure HNSW index is built from stored embeddings
    await this.ensureIndex(manifest);

    // Expand base entry ids (e.g. a pattern/decision/overview id) to every chunk id
    // (`<baseId>` and `<baseId>:<n>`) currently in the manifest for that entry.
    const allowedChunkIds = options?.allowedIds ? this.expandAllowedChunkIds(manifest, options.allowedIds) : undefined;

    // Search via HNSW index (O(log N))
    const indexResults = this.hnsw.search(queryVector, limit, allowedChunkIds);

    // Load metadata for top-K results only (O(K) disk reads)
    return await readEmbeddingSearchResults(this.embeddingsDir, indexResults, threshold, limit);
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

  async flush(): Promise<void> {
    await this.cache.flush();
  }

  async getStats(): Promise<{ total: number; generated_at: string }> {
    const manifest = await this.loadManifest();
    return {
      total: manifest.index.length,
      generated_at: manifest.generated_at,
    };
  }

  private async embedText(text: string): Promise<number[]> {
    if (!this.cacheReady) {
      await this.cache.init();
      this.cacheReady = true;
    }

    const hash = await computeTextHash(text);
    const cached = this.cache.get(hash);
    if (cached) return cached;

    if (!this.provider) {
      throw new Error("Embedding provider not configured");
    }
    const vectors = await this.provider.embed([text]);
    if (vectors.length === 0 || vectors[0].length === 0) {
      throw new Error("Embedding provider returned empty vector");
    }

    const vector = vectors[0];
    await this.cache.set(hash, vector);
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

  /** Insert-or-replace a manifest entry so re-embedding the same identity never duplicates it. */
  private async upsertManifest(id: string, title: string, embeddingFile: string): Promise<void> {
    const manifest = await this.loadManifest();
    const existingIndex = manifest.index.findIndex((entry) => entry.id === id);
    if (existingIndex !== -1) {
      manifest.index[existingIndex] = { id, title, embeddingFile };
    } else {
      manifest.index.push({ id, title, embeddingFile });
    }
    manifest.generated_at = new Date().toISOString();
    await this.saveManifest(manifest);
  }

  /** Delete indexed chunk entries `<baseId>:<n>` with n >= keepCount (stale overview chunks). */
  private async deleteChunkEntriesBeyond(baseId: string, keepCount: number): Promise<void> {
    const manifest = await this.loadManifest();
    const staleIds = manifest.index
      .map((entry) => entry.id)
      .filter((id) => {
        if (!id.startsWith(`${baseId}:`)) return false;
        const suffix = id.slice(baseId.length + 1);
        return /^\d+$/.test(suffix) && Number(suffix) >= keepCount;
      });
    for (const id of staleIds) {
      await this.deleteEmbedding(id);
    }
  }

  /** Expands base entry ids (pattern/decision/overview/execution/learning id) to every
   *  chunk id currently in the manifest for that entry — `<baseId>` and `<baseId>:<n>`. */
  private expandAllowedChunkIds(manifest: IEmbeddingManifest, baseIds: ReadonlySet<string>): Set<string> {
    const expanded = new Set<string>();
    for (const entry of manifest.index) {
      if (baseIds.has(entry.id) || this.isChunkOfAllowedBase(entry.id, baseIds)) {
        expanded.add(entry.id);
      }
    }
    return expanded;
  }

  private isChunkOfAllowedBase(chunkId: string, baseIds: ReadonlySet<string>): boolean {
    const separatorIndex = chunkId.lastIndexOf(":");
    if (separatorIndex === -1) return false;
    const suffix = chunkId.slice(separatorIndex + 1);
    if (!/^\d+$/.test(suffix)) return false;
    return baseIds.has(chunkId.slice(0, separatorIndex));
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
