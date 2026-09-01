/**
 * @module Memory
 * @path packages/core/src/types/memory.ts
 * @description Module for Memory.
 * @architectural-layer Shared
 * @related-files [packages/schemas/src/memory_bank.ts]
 */

import type { MemoryTier, MemoryType } from "./enums.ts";
import type { IDecision, IExecutionMemory, ILearning, IPattern } from "@exaix/schemas";

/**
 * Result of a semantic embedding search.
 */
export interface IEmbeddingSearchResult {
  id: string;
  title: string;
  summary: string;
  similarity: number;
  /** Which memory kind the embedding was created from; absent on legacy index entries (treated as learning). */
  kind?: MemoryType;
}

/** A memory entry of any embeddable kind, normalized for the embedding index; `kind` is the MemoryType the entry indexes under (project overviews index as MemoryType.PROJECT). */
export type IEmbeddableMemoryEntry =
  | { kind: MemoryType.LEARNING; learning: ILearning }
  | { kind: MemoryType.PATTERN; portal: string; pattern: IPattern }
  | { kind: MemoryType.DECISION; portal: string; decision: IDecision }
  | { kind: MemoryType.EXECUTION; execution: IExecutionMemory }
  | { kind: MemoryType.PROJECT; portal: string; overview: string };

/** Tracks a learning's tier, access patterns, and promotion eligibility. */
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
