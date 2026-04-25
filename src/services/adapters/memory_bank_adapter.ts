/**
 * @module MemoryBankAdapter
 * @path src/services/adapters/memory_bank_adapter.ts
 * @description Adapter for MemoryBankService that satisfies the IMemoryBankService interface.
 * @architectural-layer Services/Adapters
 * * @related-files [src/services/memory_bank.ts, src/shared/interfaces/i_memory_bank_service.ts]
 */

import type { IMemoryBankService } from "../../shared/interfaces/i_memory_bank_service.ts";
import type { MemoryBankService } from "../memory/memory_bank.ts";
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
import type { IMemoryEmbeddingService } from "../../shared/interfaces/i_memory_embedding_service.ts";

export class MemoryBankAdapter implements IMemoryBankService {
  constructor(private inner: MemoryBankService) {}

  async getProjectMemory(portal: string): Promise<IProjectMemory | null> {
    return await this.inner.getProjectMemory(portal);
  }

  async createProjectMemory(projectMem: IProjectMemory): Promise<void> {
    return await this.inner.createProjectMemory(projectMem);
  }

  async updateProjectMemory(portal: string, updates: Partial<Omit<IProjectMemory, "portal">>): Promise<void> {
    return await this.inner.updateProjectMemory(portal, updates);
  }

  async addPattern(portal: string, pattern: IPattern): Promise<void> {
    return await this.inner.addPattern(portal, pattern);
  }

  async addDecision(portal: string, decision: IDecision): Promise<void> {
    return await this.inner.addDecision(portal, decision);
  }

  async createExecutionRecord(execution: IExecutionMemory): Promise<void> {
    return await this.inner.createExecutionRecord(execution);
  }

  async getExecutionByTraceId(traceId: string): Promise<IExecutionMemory | null> {
    return await this.inner.getExecutionByTraceId(traceId);
  }

  async getExecutionHistory(portal?: string, limit?: number): Promise<IExecutionMemory[]> {
    return await this.inner.getExecutionHistory(portal, limit);
  }

  async getGlobalMemory(): Promise<IGlobalMemory | null> {
    return await this.inner.getGlobalMemory();
  }

  async initGlobalMemory(): Promise<void> {
    return await this.inner.initGlobalMemory();
  }

  async addGlobalLearning(learning: ILearning): Promise<void> {
    return await this.inner.addGlobalLearning(learning);
  }

  async promoteLearning(
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
  ): Promise<string> {
    return await this.inner.promoteLearning(portal, promotion);
  }

  async demoteLearning(learningId: string, targetPortal: string): Promise<void> {
    return await this.inner.demoteLearning(learningId, targetPortal);
  }

  async searchMemory(query: string, options?: { portal?: string; limit?: number }): Promise<IMemorySearchResult[]> {
    return await this.inner.searchMemory(query, options);
  }

  async searchByTags(tags: string[], options?: { portal?: string; limit?: number }): Promise<IMemorySearchResult[]> {
    return await this.inner.searchByTags(tags, options);
  }

  async searchByKeyword(
    keyword: string,
    options?: { portal?: string; limit?: number },
  ): Promise<IMemorySearchResult[]> {
    return await this.inner.searchByKeyword(keyword, options);
  }

  async searchMemoryAdvanced(
    options: {
      tags?: string[];
      keyword?: string;
      portal?: string;
      limit?: number;
    },
  ): Promise<IMemorySearchResult[]> {
    return await this.inner.searchMemoryAdvanced(options);
  }

  async getRecentActivity(limit?: number): Promise<IActivitySummary[]> {
    return await this.inner.getRecentActivity(limit);
  }

  async rebuildIndices(): Promise<void> {
    return await this.inner.rebuildIndices();
  }

  async rebuildIndicesWithEmbeddings(embeddingService: IMemoryEmbeddingService): Promise<void> {
    return await this.inner.rebuildIndicesWithEmbeddings(embeddingService);
  }

  async getProjects(): Promise<string[]> {
    return await this.inner.getProjects();
  }
}
