/**
 * @module HnswVectorIndex
 * @path packages/memory/src/embedding/vector_index.ts
 * @description Hierarchical Navigable Small World (HNSW) vector index for
 * approximate nearest-neighbor search. Provides O(log N) search, O(N log N)
 * construction, and supports insert/delete/save/load operations.
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

interface HnswNode {
  id: string;
  vector: number[];
  level: number;
  neighbors: Map<number, Set<string>>;
}

// Brute-force is used below this size; HNSW kicks in for larger datasets.
// Current embedding dimension is 64 — brute-force is fast enough for <10k entries.
const BRUTE_FORCE_THRESHOLD = 100;
const DEFAULT_M = 16;
const DEFAULT_EF_CONSTRUCTION = 200;
const DEFAULT_EF_SEARCH = 50;
const ML = 1 / Math.log(DEFAULT_M);

function generateLevel(): number {
  return Math.floor(-Math.log(Math.random()) * ML);
}

export class HnswVectorIndex {
  private nodes = new Map<string, HnswNode>();
  private entryPoint: string | null = null;
  private maxLevel = 0;
  private m = DEFAULT_M;
  private efConstruction = DEFAULT_EF_CONSTRUCTION;
  private efSearch = DEFAULT_EF_SEARCH;

  constructor(options?: {
    m?: number;
    efConstruction?: number;
    efSearch?: number;
  }) {
    if (options?.m !== undefined) this.m = options.m;
    if (options?.efConstruction !== undefined) this.efConstruction = options.efConstruction;
    if (options?.efSearch !== undefined) this.efSearch = options.efSearch;
  }

  size(): number {
    return this.nodes.size;
  }

  insert(id: string, vector: number[]): void {
    if (this.nodes.has(id)) {
      this.delete(id);
    }

    const level = generateLevel();
    const node: HnswNode = {
      id,
      vector,
      level,
      neighbors: new Map(),
    };

    for (let lvl = 0; lvl <= level; lvl++) {
      node.neighbors.set(lvl, new Set());
    }

    this.nodes.set(id, node);

    if (this.entryPoint === null) {
      this.entryPoint = id;
      this.maxLevel = level;
      return;
    }

    let currId = this.entryPoint;

    for (let lvl = this.maxLevel; lvl > level; lvl--) {
      currId = this.greedySearchLevel(currId, vector, lvl);
    }

    for (let lvl = Math.min(level, this.maxLevel); lvl >= 0; lvl--) {
      const nearest = this.searchLayer(currId, vector, lvl, this.efConstruction);
      const neighbors = this.selectNeighbors(nearest, this.m);

      for (const n of neighbors) {
        node.neighbors.get(lvl)!.add(n.id);
        const neighborNode = this.nodes.get(n.id)!;
        if (!neighborNode.neighbors.has(lvl)) {
          neighborNode.neighbors.set(lvl, new Set());
        }
        neighborNode.neighbors.get(lvl)!.add(id);

        if (neighborNode.neighbors.get(lvl)!.size > this.m) {
          const neighborCandidates = this.getNeighborCandidates(neighborNode, lvl);
          const selected = this.selectNeighbors(neighborCandidates, this.m);
          neighborNode.neighbors.set(lvl, new Set(selected.map((s) => s.id)));
        }
      }
    }

    if (level > this.maxLevel) {
      this.maxLevel = level;
      this.entryPoint = id;
    }
  }

  delete(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;

    for (const [lvl, neighborIds] of node.neighbors) {
      for (const nid of neighborIds) {
        const neighbor = this.nodes.get(nid);
        if (!neighbor) continue;
        const nset = neighbor.neighbors.get(lvl);
        if (nset) {
          nset.delete(id);
        }
      }
    }

    this.nodes.delete(id);

    if (this.entryPoint === id) {
      const firstKey = this.nodes.keys().next().value;
      this.entryPoint = firstKey !== undefined ? firstKey : null;
      this.maxLevel = this.entryPoint === null ? 0 : this.computeMaxLevel();
    }
  }

  search(query: number[], k: number): Array<{ id: string; similarity: number }> {
    if (this.nodes.size === 0 || k <= 0) return [];

    if (this.nodes.size <= BRUTE_FORCE_THRESHOLD) {
      return this.bruteForceSearch(query, k);
    }

    let currId = this.entryPoint!;

    for (let lvl = this.maxLevel; lvl > 0; lvl--) {
      currId = this.greedySearchLevel(currId, query, lvl);
    }

    const nearest = this.searchLayer(currId, query, 0, Math.max(this.efSearch, k));

    nearest.sort((a, b) => b.similarity - a.similarity);

    return nearest.slice(0, k).map((n) => ({
      id: n.id,
      similarity: n.similarity,
    }));
  }

  rebuildFromVectors(vectors: Map<string, number[]>): void {
    this.nodes.clear();
    this.entryPoint = null;
    this.maxLevel = 0;

    for (const [id, vector] of vectors) {
      this.insert(id, vector);
    }
  }

  save(): IVectorIndexSnapshot {
    const entries: IVectorIndexEntry[] = [];
    for (const node of this.nodes.values()) {
      entries.push({ id: node.id, vector: node.vector });
    }
    return { entries };
  }

  load(snapshot: IVectorIndexSnapshot): void {
    this.rebuildFromVectors(
      new Map(snapshot.entries.map((e) => [e.id, e.vector])),
    );
  }

  private greedySearchLevel(currId: string, query: number[], level: number): string {
    let best = currId;
    let bestDist = 1 - cosineSimilarity(query, this.nodes.get(currId)!.vector);
    let changed = true;

    while (changed) {
      changed = false;
      const node = this.nodes.get(best)!;
      const neighbors = node.neighbors.get(level);
      if (!neighbors) break;

      for (const nid of neighbors) {
        const dist = 1 - cosineSimilarity(query, this.nodes.get(nid)!.vector);
        if (dist < bestDist) {
          bestDist = dist;
          best = nid;
          changed = true;
        }
      }
    }

    return best;
  }

  private searchLayer(
    currId: string,
    query: number[],
    level: number,
    ef: number,
  ): Array<{ id: string; similarity: number }> {
    const visited = new Set<string>([currId]);
    const candidates = [{ id: currId, dist: 1 - cosineSimilarity(query, this.nodes.get(currId)!.vector) }];
    const results = new Map<string, number>();

    results.set(currId, candidates[0].dist);

    while (candidates.length > 0) {
      candidates.sort((a, b) => a.dist - b.dist);
      const closest = candidates.shift()!;

      const furthestDist = this.getFurthestDist(results);

      if (closest.dist > furthestDist) break;

      const node = this.nodes.get(closest.id)!;
      const neighbors = node.neighbors.get(level);
      if (!neighbors) continue;

      for (const nid of neighbors) {
        if (visited.has(nid)) continue;
        visited.add(nid);

        const dist = 1 - cosineSimilarity(query, this.nodes.get(nid)!.vector);
        const furthestDist2 = this.getFurthestDist(results);

        if (dist < furthestDist2 || results.size < ef) {
          candidates.push({ id: nid, dist });
          results.set(nid, dist);
        }
      }
    }

    const sorted = [...results.entries()]
      .map(([id, dist]) => ({ id, similarity: 1 - dist }))
      .sort((a, b) => b.similarity - a.similarity);

    return sorted.slice(0, ef);
  }

  private selectNeighbors(
    candidates: Array<{ id: string; similarity: number }>,
    m: number,
  ): Array<{ id: string; similarity: number }> {
    candidates.sort((a, b) => b.similarity - a.similarity);
    return candidates.slice(0, m);
  }

  private getNeighborCandidates(
    node: HnswNode,
    level: number,
  ): Array<{ id: string; similarity: number }> {
    const neighbors = node.neighbors.get(level);
    if (!neighbors) return [];
    return [...neighbors].map((nid) => ({
      id: nid,
      similarity: cosineSimilarity(node.vector, this.nodes.get(nid)?.vector ?? []),
    }));
  }

  private getFurthestDist(results: Map<string, number>): number {
    let max = -Infinity;
    for (const dist of results.values()) {
      if (dist > max) max = dist;
    }
    return max === -Infinity ? Infinity : max;
  }

  private computeMaxLevel(): number {
    let max = 0;
    for (const node of this.nodes.values()) {
      if (node.level > max) max = node.level;
    }
    return max;
  }

  private bruteForceSearch(
    query: number[],
    k: number,
  ): Array<{ id: string; similarity: number }> {
    const results = [];
    for (const node of this.nodes.values()) {
      const similarity = cosineSimilarity(query, node.vector);
      results.push({ id: node.id, similarity });
    }
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k);
  }
}
