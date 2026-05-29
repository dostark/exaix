/**
 * @module HnswVectorIndex
 * @path packages/memory/src/embedding/vector_index.ts
 * @description Brute-force vector index for approximate nearest-neighbor search.
 * Uses O(n) linear scan, which is fast enough at current scale (64-dim vectors,
 * typically <1 000 entries). The class name and public API are preserved so that
 * callers do not need to change.
 *
 * FUTURE: replace with a true HNSW implementation when the entry count exceeds
 * ~10 000 and the O(n) scan becomes a measurable bottleneck.
 * @architectural-layer Services
 * @related-files ["./memory_embedding.ts", "./provider_embedding_service.ts"]
 */
import { cosineSimilarity } from "./memory_embedding.ts";

export interface IVectorIndexEntry {
  id: string;
  vector: number[];
}

export interface IVectorIndexSnapshot {
  entries: IVectorIndexEntry[];
}

export class HnswVectorIndex {
  private vectors = new Map<string, number[]>();

  size(): number {
    return this.vectors.size;
  }

  insert(id: string, vector: number[]): void {
    this.vectors.set(id, vector);
  }

  delete(id: string): void {
    this.vectors.delete(id);
  }

  search(query: number[], k: number): Array<{ id: string; similarity: number }> {
    if (this.vectors.size === 0 || k <= 0) return [];

    const results: Array<{ id: string; similarity: number }> = [];
    for (const [id, vector] of this.vectors) {
      results.push({ id, similarity: cosineSimilarity(query, vector) });
    }
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k);
  }

  rebuildFromVectors(vectors: Map<string, number[]>): void {
    this.vectors = new Map(vectors);
  }

  save(): IVectorIndexSnapshot {
    const entries: IVectorIndexEntry[] = [];
    for (const [id, vector] of this.vectors) {
      entries.push({ id, vector });
    }
    return { entries };
  }

  load(snapshot: IVectorIndexSnapshot): void {
    this.vectors = new Map(snapshot.entries.map((e) => [e.id, e.vector]));
  }
}
