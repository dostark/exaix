/**
 * @module Memory
 * @path packages/core/src/types/memory.ts
 * @description Module for Memory.
 * @architectural-layer Shared
 * @related-files [packages/schemas/src/memory_bank.ts]
 */

/**
 * Result of a semantic embedding search.
 */
export interface IEmbeddingSearchResult {
  id: string;
  title: string;
  summary: string;
  similarity: number;
}
