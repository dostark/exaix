/**
 * @module ImemoryBankService
 * @path src/shared/interfaces/i_memory_bank_service.ts
 * @description Module for ImemoryBankService.
 * @architectural-layer Shared
 * * @related-files [src/shared/schemas/memory_bank.ts]
 */

import type { MemoryType } from "@exaix/core";
import type {
  IActivitySummary,
  IDecision,
  IExecutionMemory,
  IGlobalMemory,
  ILearning,
  IMemorySearchResult,
  IPattern,
  IProjectMemory,
} from "@exaix/schemas/memory_bank.ts";
import type { IMemoryEmbeddingService } from "./i_memory_embedding_service.ts";

export interface IMemoryBankService {
  /**
   * Get project-specific memory for a portal.
   */
  getProjectMemory(portal: string): Promise<IProjectMemory | null>;

  /**
   * Create a new project memory entry.
   */
  createProjectMemory(projectMem: IProjectMemory): Promise<void>;

  /**
   * Update existing project memory.
   */
  updateProjectMemory(portal: string, updates: Partial<Omit<IProjectMemory, "portal">>): Promise<void>;

  /**
   * Add a single pattern to a project's memory.
   */
  addPattern(portal: string, pattern: IPattern): Promise<void>;

  /**
   * Add a single decision to a project's memory.
   */
  addDecision(portal: string, decision: IDecision): Promise<void>;

  /**
   * Record a completed execution.
   */
  createExecutionRecord(execution: IExecutionMemory): Promise<void>;

  /**
   * Retrieve an execution record by trace ID.
   */
  getExecutionByTraceId(traceId: string): Promise<IExecutionMemory | null>;

  /**
   * Get execution history, optionally filtered by portal.
   */
  getExecutionHistory(portal?: string, limit?: number): Promise<IExecutionMemory[]>;

  /**
   * Get global memory bank content.
   */
  getGlobalMemory(): Promise<IGlobalMemory | null>;

  /**
   * Initialize global memory bank.
   */
  initGlobalMemory(): Promise<void>;

  /**
   * Add a learning to the global memory bank.
   */
  addGlobalLearning(learning: ILearning): Promise<void>;

  /**
   * Promote a project-specific learning to the global bank.
   */
  promoteLearning(
    portal: string,
    promotion: {
      type: MemoryType.PATTERN | MemoryType.DECISION;
      name: string;
      title: string;
      description: string;
      category: ILearning["category"];
      tags: string[];
      confidence: ILearning["confidence"];
    },
  ): Promise<string>;

  /**
   * Demote a global learning to a specific project.
   */
  demoteLearning(learningId: string, targetPortal: string): Promise<void>;

  /**
   * Search across all memory banks.
   */
  searchMemory(query: string, options?: { portal?: string; limit?: number }): Promise<IMemorySearchResult[]>;

  /**
   * Search memory by tags.
   */
  searchByTags(tags: string[], options?: { portal?: string; limit?: number }): Promise<IMemorySearchResult[]>;

  /**
   * Search memory by keyword.
   */
  searchByKeyword(keyword: string, options?: { portal?: string; limit?: number }): Promise<IMemorySearchResult[]>;

  /**
   * Advanced memory search with multiple filters.
   */
  searchMemoryAdvanced(
    options: {
      tags?: string[];
      keyword?: string;
      portal?: string;
      limit?: number;
    },
  ): Promise<IMemorySearchResult[]>;

  /**
   * Get recent system activity across all portals.
   */
  getRecentActivity(limit?: number): Promise<IActivitySummary[]>;

  /**
   * Rebuild memory indices.
   */
  rebuildIndices(): Promise<void>;

  /**
   * Rebuild memory indices including semantic embeddings.
   */
  rebuildIndicesWithEmbeddings(embeddingService: IMemoryEmbeddingService): Promise<void>;

  /**
   * Get list of project names (aliases) from memory banks.
   */
  getProjects(): Promise<string[]>;
}
