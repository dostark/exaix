/**
 * @module OllamaEmbeddingService
 * @path src/services/memory/ollama_embedding_service.ts
 * @description IMemoryEmbeddingService implementation backed by an
 * IEmbeddingProvider (Ollama, OpenAI, etc.). Stores embedding vectors as
 * JSON files alongside an LRU cache for duplicate input deduplication.
 * @architectural-layer Services
 * @dependencies [src/ai/embeddings/embedding_provider.ts, src/services/memory/memory_embedding.ts, src/shared/constants.ts]
 * @related-files [src/services/memory/memory_bank.ts, "packages/core/src/types/i_memory_embedding_service.ts"]
 */

import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import type { Config } from "@exaix/schemas/config.ts";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import type { IEmbeddingSearchResult } from "@exaix/core/types/memory.ts";
import type { IEmbeddingProvider } from "@exaix/ai/embeddings/embedding_provider.ts";
import type { IMemoryEmbeddingService } from "@exaix/core/types";
import { cosineSimilarity } from "./memory_embedding.ts";
import { OLLAMA_EMBED_CACHE_MAX_ENTRIES } from "@exaix/ai";

/**
 * Embedding file structure stored on disk.
 */
interface IEmbeddingFile {
  id: string;
  title: string;
  text: string;
  vector: number[];
  created_at: string;
}

/**
 * Manifest entry for an embedding.
 */
interface IManifestEntry {
  id: string;
  title: string;
  embeddingFile: string;
}

/**
 * Manifest tracking all stored embeddings.
 */
interface IEmbeddingManifest {
  generated_at: string;
  index: IManifestEntry[];
}

/**
 * LRU cache for embedding inputs to avoid redundant API calls.
 */
class EmbeddingLruCache {
  private entries = new Map<string, number[]>();

  get size(): number {
    return this.entries.size;
  }

  get(key: string): number[] | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key)!;
    // Move to end (most recently used)
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: number[]): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= OLLAMA_EMBED_CACHE_MAX_ENTRIES) {
      // Evict oldest entry
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.set(key, value);
  }
}

/**
 * Embedding service that uses an IEmbeddingProvider for vector generation.
 * Stores vectors as JSON files with a manifest index.
 */
export class OllamaEmbeddingService implements IMemoryEmbeddingService {
  private embeddingsDir: string;
  private manifestPath: string;
  private cache: EmbeddingLruCache;

  constructor(
    private config: Config,
    private provider: IEmbeddingProvider,
  ) {
    this.embeddingsDir = join(config.system.root, config.paths.memory, "Index", "embeddings");
    this.manifestPath = join(this.embeddingsDir, "manifest.json");
    this.cache = new EmbeddingLruCache();
  }

  /**
   * Initialize the embeddings directory and manifest.
   */
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

  /**
   * Generate and store an embedding for a learning entry.
   */
  async embedLearning(learning: ILearning): Promise<void> {
    await this.initializeManifest();

    const text = `${learning.title} ${learning.description}`;
    const vector = await this.embedText(text);

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
  }

  /**
   * Search for similar learnings using embedding similarity.
   */
  async searchByEmbedding(
    query: string,
    options?: { limit?: number; threshold?: number },
  ): Promise<IEmbeddingSearchResult[]> {
    const manifest = await this.loadManifest();
    if (manifest.index.length === 0) return [];

    const queryVector = await this.embedText(query);
    const results: IEmbeddingSearchResult[] = [];

    for (const entry of manifest.index) {
      try {
        const fileContent = await Deno.readTextFile(entry.embeddingFile);
        const embedding: IEmbeddingFile = JSON.parse(fileContent) as IEmbeddingFile;
        const similarity = cosineSimilarity(queryVector, embedding.vector);

        const threshold = options?.threshold ?? 0.0;
        if (similarity >= threshold) {
          results.push({
            id: embedding.id,
            title: embedding.title,
            summary: embedding.text.substring(0, 200),
            similarity,
          });
        }
      } catch {
        // File not readable — skip silently
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);

    const limit = options?.limit ?? 10;
    return results.slice(0, limit);
  }

  /**
   * Get the raw embedding vector for a learning.
   */
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

  /**
   * Delete embedding data for a learning.
   */
  async deleteEmbedding(id: string): Promise<void> {
    const manifest = await this.loadManifest();
    const entryIndex = manifest.index.findIndex((e) => e.id === id);
    if (entryIndex === -1) return;

    const entry = manifest.index[entryIndex];

    // Remove embedding file
    try {
      await Deno.remove(entry.embeddingFile);
    } catch {
      // File already gone — continue
    }

    // Remove from manifest
    manifest.index.splice(entryIndex, 1);
    manifest.generated_at = new Date().toISOString();
    await this.saveManifest(manifest);
  }

  /**
   * Get metadata about the embedding index.
   */
  async getStats(): Promise<{ total: number; generated_at: string }> {
    const manifest = await this.loadManifest();
    return {
      total: manifest.index.length,
      generated_at: manifest.generated_at,
    };
  }

  /**
   * Embed a single text string, using LRU cache for deduplication.
   */
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

  /**
   * Load the embedding manifest from disk.
   */
  private async loadManifest(): Promise<IEmbeddingManifest> {
    await this.initializeManifest();
    const content = await Deno.readTextFile(this.manifestPath);
    return JSON.parse(content) as IEmbeddingManifest;
  }

  /**
   * Save the manifest to disk.
   */
  private async saveManifest(manifest: IEmbeddingManifest): Promise<void> {
    await Deno.writeTextFile(this.manifestPath, JSON.stringify(manifest, null, 2));
  }

  /**
   * Add an entry to the manifest and save.
   */
  private async updateManifest(id: string, title: string, embeddingFile: string): Promise<void> {
    const manifest = await this.loadManifest();
    manifest.index.push({ id, title, embeddingFile });
    manifest.generated_at = new Date().toISOString();
    await this.saveManifest(manifest);
  }
}
