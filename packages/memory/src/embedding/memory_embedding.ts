/**
 * @module MemoryEmbedding
 * @path packages/memory/src/embedding/memory_embedding.ts
 * @description Generates and searches semantic embeddings for memories using deterministic hash-based mock vectors for lightweight RAG support.
 * @architectural-layer Services
 * @related-files ["packages/memory/src/session/session_memory.ts", "packages/memory/src/bank/memory_bank.ts"]
 */

import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import type { Config } from "@exaix/schemas/config.ts";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import type { IEmbeddableMemoryEntry, Opt, Reason } from "@exaix/core/types";
import { MemoryType } from "@exaix/core";
import { HnswVectorIndex } from "./vector_index.ts";
import {
  chunkEmbeddingId,
  embeddableId,
  embeddableTextChunks,
  embeddableTitle,
  LEGACY_EMBEDDING_KIND,
} from "./embeddable_entry.ts";

/**
 * Embedding search result
 */
export interface IEmbeddingSearchResult {
  id: string;
  title: string;
  summary: string;
  similarity: number;
  /** Which memory kind the embedding was created from; absent on legacy index entries (treated as learning). */
  kind?: MemoryType;
}

/** 64-dimensional mock embedding vector interface. */
export interface IMemoryEmbeddingService {
  initializeManifest(): Promise<void>;
  embedLearning(learning: ILearning): Promise<void>;
  embed(entry: IEmbeddableMemoryEntry): Promise<void>;
  searchByEmbedding(
    query: string,
    options?: Opt<{ limit?: number; threshold?: number }, Reason.QueryFilter>,
  ): Promise<IEmbeddingSearchResult[]>;
  getEmbedding(id: string): Promise<number[] | null>;
  deleteEmbedding(id: string): Promise<void>;
  getStats(): Promise<{ total: number; generated_at: string }>;
}

const EMBEDDING_DIM = 64;

/** Embedding file structure (stored as JSON). */
interface EmbeddingFile {
  id: string;
  title: string;
  text: string;
  vector: number[];
  created_at: string;
  kind?: MemoryType;
}

/** Manifest entry for an embedding. */
interface ManifestEntry {
  id: string;
  title: string;
  embeddingFile: string;
}

/** Manifest file structure. */
interface EmbeddingManifest {
  generated_at: string;
  index: ManifestEntry[];
}

/** Calculate cosine similarity between two vectors (-1 to 1). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/** Generate a deterministic normalized mock embedding vector from text. */
export function generateMockEmbedding(text: string): number[] {
  const vector = new Array(EMBEDDING_DIM).fill(0);

  // Simple hash function for deterministic output
  const hashCode = (s: string): number => {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      const char = s.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  };

  // Generate deterministic values for each dimension
  const words = text.toLowerCase().split(/\s+/);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    let value = 0;
    for (const word of words) {
      // Each word contributes to the vector based on position and hash
      const wordHash = hashCode(word + i.toString());
      value += Math.sin(wordHash * 0.001) * 0.1;
    }
    vector[i] = value;
  }

  // Normalize to unit length
  let magnitude = 0;
  for (const val of vector) {
    magnitude += val * val;
  }
  magnitude = Math.sqrt(magnitude);

  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= magnitude;
    }
  }

  return vector;
}

/** @deprecated Use ProviderEmbeddingService with a real embedding provider. */
export class MemoryEmbeddingService implements IMemoryEmbeddingService {
  private embeddingsDir: string;
  private manifestPath: string;
  private hnsw: HnswVectorIndex;
  private indexBuilt = false;

  /** Create a new Memory Embedding Service instance. */
  constructor(private config: Config) {
    this.embeddingsDir = join(config.system.root, config.paths.memory, "Index", "embeddings");
    this.manifestPath = join(this.embeddingsDir, "manifest.json");
    this.hnsw = new HnswVectorIndex();
  }

  /** Initialize the embeddings directory and manifest. */
  async initializeManifest(): Promise<void> {
    await ensureDir(this.embeddingsDir);

    // Create empty manifest if it doesn't exist
    if (!await exists(this.manifestPath)) {
      const manifest: EmbeddingManifest = {
        generated_at: new Date().toISOString(),
        index: [],
      };
      await Deno.writeTextFile(this.manifestPath, JSON.stringify(manifest, null, 2));
    }
  }

  /** Embed a learning and save to file. */
  async embedLearning(learning: ILearning): Promise<void> {
    await this.embed({ kind: MemoryType.LEARNING, learning });
  }

  /** Embed any embeddable memory entry (mock vectors; idempotent per key). */
  async embed(entry: IEmbeddableMemoryEntry): Promise<void> {
    await this.initializeManifest();

    const chunks = embeddableTextChunks(entry);
    if (chunks.length === 0) return;

    const baseId = embeddableId(entry);
    const title = embeddableTitle(entry);

    for (let index = 0; index < chunks.length; index++) {
      const id = chunkEmbeddingId(baseId, index);
      const vector = generateMockEmbedding(chunks[index]);

      const embeddingFile: EmbeddingFile = {
        id,
        title,
        text: chunks[index],
        vector,
        created_at: new Date().toISOString(),
        kind: entry.kind,
      };

      const embeddingPath = join(this.embeddingsDir, `${id}.json`);
      await Deno.writeTextFile(embeddingPath, JSON.stringify(embeddingFile, null, 2));

      await this.updateManifest(id, title, embeddingPath);
      this.hnsw.insert(id, vector);
      this.indexBuilt = true;
    }

    await this.deleteChunkEntriesBeyond(baseId, chunks.length);
  }

  /** Update the manifest with a new or updated embedding. */
  private async updateManifest(id: string, title: string, embeddingPath: string): Promise<void> {
    let manifest: EmbeddingManifest;

    if (await exists(this.manifestPath)) {
      const content = await Deno.readTextFile(this.manifestPath);
      manifest = JSON.parse(content);
    } else {
      manifest = {
        generated_at: new Date().toISOString(),
        index: [],
      };
    }

    // Check if entry already exists
    const existingIndex = manifest.index.findIndex((e) => e.id === id);
    const entry: ManifestEntry = {
      id,
      title,
      embeddingFile: embeddingPath,
    };

    if (existingIndex >= 0) {
      // Update existing entry
      manifest.index[existingIndex] = entry;
    } else {
      // Add new entry
      manifest.index.push(entry);
    }

    manifest.generated_at = new Date().toISOString();
    await Deno.writeTextFile(this.manifestPath, JSON.stringify(manifest, null, 2));
  }

  /** Search for similar learnings using embedding similarity sorted by score. */
  async searchByEmbedding(
    query: string,
    options?: Opt<{ limit?: number; threshold?: number }, Reason.QueryFilter>,
  ): Promise<IEmbeddingSearchResult[]> {
    await this.initializeManifest();
    const limit = options?.limit || 10;
    const threshold = options?.threshold || 0.0;

    // Load manifest
    if (!await exists(this.manifestPath)) {
      return [];
    }

    const manifestContent = await Deno.readTextFile(this.manifestPath);
    const manifest: EmbeddingManifest = JSON.parse(manifestContent);

    if (manifest.index.length === 0) {
      return [];
    }

    // Ensure HNSW index is built from stored embeddings
    await this.ensureIndex(manifest);

    // Generate query embedding
    const queryVector = generateMockEmbedding(query);

    // Search via HNSW index (O(log N))
    const indexResults = this.hnsw.search(queryVector, limit);

    // Load metadata for top-K results only (O(K) disk reads)
    const results: IEmbeddingSearchResult[] = [];
    for (const ir of indexResults) {
      if (ir.similarity < threshold) continue;
      const embeddingPath = join(this.embeddingsDir, `${ir.id}.json`);
      try {
        const content = await Deno.readTextFile(embeddingPath);
        const embedding: EmbeddingFile = JSON.parse(content);
        results.push({
          id: embedding.id,
          title: embedding.title,
          summary: embedding.text.substring(0, 200),
          similarity: ir.similarity,
          kind: embedding.kind ?? LEGACY_EMBEDDING_KIND,
        });
      } catch {
        continue;
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, limit);
  }

  /** Get embedding for a specific learning or null if not found. */
  async getEmbedding(id: string): Promise<number[] | null> {
    await this.initializeManifest();
    const embeddingPath = join(this.embeddingsDir, `${id}.json`);
    if (!await exists(embeddingPath)) {
      return null;
    }

    try {
      const content = await Deno.readTextFile(embeddingPath);
      const embedding: EmbeddingFile = JSON.parse(content);
      return embedding.vector;
    } catch {
      return null;
    }
  }

  /** Delete embedding for a specific learning ID. */
  async deleteEmbedding(id: string): Promise<void> {
    await this.initializeManifest();
    const embeddingPath = join(this.embeddingsDir, `${id}.json`);
    if (await exists(embeddingPath)) {
      await Deno.remove(embeddingPath);
    }

    // Update manifest to remove entry
    if (await exists(this.manifestPath)) {
      const content = await Deno.readTextFile(this.manifestPath);
      const manifest: EmbeddingManifest = JSON.parse(content);
      manifest.index = manifest.index.filter((e) => e.id !== id);
      manifest.generated_at = new Date().toISOString();
      await Deno.writeTextFile(this.manifestPath, JSON.stringify(manifest, null, 2));
    }

    // Update HNSW index
    this.hnsw.delete(id);
  }

  /** Delete indexed chunk entries `<baseId>:<n>` with n >= keepCount (stale overview chunks). */
  private async deleteChunkEntriesBeyond(baseId: string, keepCount: number): Promise<void> {
    await this.initializeManifest();
    if (!await exists(this.manifestPath)) return;
    const content = await Deno.readTextFile(this.manifestPath);
    const manifest: EmbeddingManifest = JSON.parse(content);
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

  /** Get statistics about embeddings. */
  async getStats(): Promise<{ total: number; generated_at: string }> {
    await this.initializeManifest();
    if (!await exists(this.manifestPath)) {
      return { total: 0, generated_at: "" };
    }

    const content = await Deno.readTextFile(this.manifestPath);
    const manifest: EmbeddingManifest = JSON.parse(content);
    return {
      total: manifest.index.length,
      generated_at: manifest.generated_at,
    };
  }

  private async ensureIndex(manifest: EmbeddingManifest): Promise<void> {
    if (this.indexBuilt) return;

    const vectors = new Map<string, number[]>();
    for (const entry of manifest.index) {
      const embeddingPath = join(this.embeddingsDir, `${entry.id}.json`);
      try {
        const content = await Deno.readTextFile(embeddingPath);
        const embedding: EmbeddingFile = JSON.parse(content);
        vectors.set(entry.id, embedding.vector);
      } catch {
        continue;
      }
    }

    this.hnsw.rebuildFromVectors(vectors);
    this.indexBuilt = true;
  }
}
