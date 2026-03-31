/**
 * @module Memory
 * @path src/shared/types/memory.ts
 * @description Module for Memory.
 * @architectural-layer Shared
 * * @related-files [src/shared/schemas/memory_bank.ts]
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
