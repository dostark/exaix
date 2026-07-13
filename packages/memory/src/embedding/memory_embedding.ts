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
import { HnswVectorIndex } from "./vector_index.ts";

/**
 * Embedding search result
 */
export interface IEmbeddingSearchResult {
  id: string;
  title: string;
  summary: string;
  similarity: number;
}

/**
 * Embedding vector dimension
 * Using 64 dimensions for mock embeddings - lightweight but sufficient
 * for demonstrating semantic similarity
 */
export interface IMemoryEmbeddingService {
  initializeManifest(): Promise<void>;
  embedLearning(learning: ILearning): Promise<void>;
  searchByEmbedding(
    query: string,
    options?: { limit?: number; threshold?: number },
  ): Promise<IEmbeddingSearchResult[]>;
  getEmbedding(id: string): Promise<number[] | null>;
  deleteEmbedding(id: string): Promise<void>;
  getStats(): Promise<{ total: number; generated_at: string }>;
}

const EMBEDDING_DIM = 64;

/**
 * Embedding file structure (stored as JSON)
 */
interface EmbeddingFile {
  id: string;
  title: string;
  text: string;
  vector: number[];
  created_at: string;
}

/**
 * Manifest entry for an embedding
 */
interface ManifestEntry {
  id: string;
  title: string;
  embeddingFile: string;
}

/**
 * Manifest file structure
 */
interface EmbeddingManifest {
  generated_at: string;
  index: ManifestEntry[];
}

/**
 * Calculate cosine similarity between two vectors
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity (-1 to 1)
 */
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

/**
 * Generate a deterministic mock embedding from text
 *
 * Uses a simple hash-based approach to create reproducible vectors.
 * This is NOT suitable for production semantic search, but demonstrates
 * the embedding workflow without external dependencies.
 *
 * @param text - Text to embed
 * @returns Normalized embedding vector
 */
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

/**
 * Memory Embedding Service
 *
 * Manages embedding generation and search for memory learnings.
 *
 * @deprecated Use ProviderEmbeddingService from packages/memory/src/embedding/provider_embedding_service.ts.
 *   MemoryEmbeddingService uses deterministic hash-based mock vectors and is retained only for
 *   backward compatibility with existing test fixtures. All production code in the daemon
 *   now uses ProviderEmbeddingService with a real embedding provider.
 */
export class MemoryEmbeddingService implements IMemoryEmbeddingService {
  private embeddingsDir: string;
  private manifestPath: string;
  private hnsw: HnswVectorIndex;
  private indexBuilt = false;

  /**
   * Create a new Memory Embedding Service instance
   *
   * @param config - Exaix configuration
   */
  constructor(private config: Config) {
    this.embeddingsDir = join(config.system.root, config.paths.memory, "Index", "embeddings");
    this.manifestPath = join(this.embeddingsDir, "manifest.json");
    this.hnsw = new HnswVectorIndex();
  }

  /**
   * Initialize the embeddings directory and manifest
   */
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

  /**
   * Embed a learning and save to file
   *
   * @param learning - ILearning to embed
   */
  async embedLearning(learning: ILearning): Promise<void> {
    await this.initializeManifest();

    // Generate text for embedding (title + description)
    const text = `${learning.title} ${learning.description}`;
    const vector = generateMockEmbedding(text);

    // Create embedding file
    const embeddingFile: EmbeddingFile = {
      id: learning.id,
      title: learning.title,
      text: text,
      vector: vector,
      created_at: new Date().toISOString(),
    };

    const embeddingPath = join(this.embeddingsDir, `${learning.id}.json`);
    await Deno.writeTextFile(embeddingPath, JSON.stringify(embeddingFile, null, 2));

    // Update manifest
    await this.updateManifest(learning.id, learning.title, embeddingPath);

    // Update HNSW index
    this.hnsw.insert(learning.id, vector);
    this.indexBuilt = true;
  }

  /**
   * Update the manifest with a new or updated embedding
   *
   * @param id - ILearning ID
   * @param title - ILearning title
   * @param embeddingPath - Path to the embedding file
   */
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

  /**
   * Search for similar learnings using embedding similarity
   *
   * @param query - Search query text
   * @param options - Search options (limit, threshold)
   * @returns Array of search results sorted by similarity
   */
  async searchByEmbedding(
    query: string,
    options?: { limit?: number; threshold?: number },
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
        });
      } catch {
        continue;
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, limit);
  }

  /**
   * Get embedding for a specific learning
   *
   * @param id - ILearning ID
   * @returns Embedding vector or null if not found
   */
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

  /**
   * Delete embedding for a specific learning
   *
   * @param id - ILearning ID
   */
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

  /**
   * Get statistics about embeddings
   *
   * @returns Embedding statistics
   */
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
