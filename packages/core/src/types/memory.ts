/**
 * @module Memory
 * @path packages/core/src/types/memory.ts
 * @description Module for Memory.
 * @architectural-layer Shared
 * @related-files [packages/schemas/src/memory_bank.ts]
 */

import type { MemoryTier } from "./enums.ts";

/**
 * Result of a semantic embedding search.
 */
export interface IEmbeddingSearchResult {
  id: string;
  title: string;
  summary: string;
  similarity: number;
}

/**
 * Tiered memory entry for hierarchical promotion.
 * Tracks a learning's tier, access patterns, and promotion eligibility.
 */
export interface ITieredMemoryEntry {
  /** Unique identifier, matching the corresponding ILearning.id. */
  id: string;
  /** The text content / summary of the learning. */
  content: string;
  /** Current tier in the promotion hierarchy. */
  tier: MemoryTier;
  /** Originating execution context. */
  source: {
    planId: string;
    stepId: string;
  };
  /** When the entry was first created. */
  createdAt: number;
  /** When the entry was last accessed (for LRU within tier). */
  lastAccessedAt: number;
  /** Number of times the entry has been accessed. */
  accessCount: number;
  /** Score used for WORKING → EPISODIC promotion decisions. */
  promotionScore: number;
}
