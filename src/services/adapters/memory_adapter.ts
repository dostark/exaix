/**
 * @module MemoryAdapter
 * @path src/services/adapters/memory_adapter.ts
 * @description Adapter implementing IMemoryService by delegating to MemoryBankService and MemoryExtractorService.
 * @architectural-layer Services
 * * @related-files [src/services/memory_bank.ts, src/services/memory_extractor.ts, src/shared/interfaces/i_memory_service.ts]
 */

import type { IMemoryService } from "../../shared/interfaces/i_memory_service.ts";
import type { MemoryBankService } from "../memory/memory_bank.ts";
import type { MemoryExtractorService } from "../memory/memory_extractor.ts";
import type {
  IExecutionMemory,
  IGlobalMemory,
  IMemorySearchResult,
  IMemoryUpdateProposal,
  IProjectMemory,
} from "../../shared/schemas/memory_bank.ts";

/**
 * Adapter that implements the IMemoryService interface used by the TUI
 * and delegates to the core services.
 */
export class MemoryServiceAdapter implements IMemoryService {
  constructor(
    private memoryBank: MemoryBankService,
    private extractor: MemoryExtractorService,
  ) {}

  /**
   * Get list of project names (aliases)
   */
  async getProjects(): Promise<string[]> {
    return await this.memoryBank.getProjects();
  }

  /**
   * Get memory content for a specific project
   */
  async getProjectMemory(portal: string): Promise<IProjectMemory | null> {
    return await this.memoryBank.getProjectMemory(portal);
  }

  /**
   * Get global memory bank content
   */
  async getGlobalMemory(): Promise<IGlobalMemory | null> {
    return await this.memoryBank.getGlobalMemory();
  }

  /**
   * Get an execution record by its trace ID
   */
  async getExecutionByTraceId(traceId: string): Promise<IExecutionMemory | null> {
    return await this.memoryBank.getExecutionByTraceId(traceId);
  }

  /**
   * Get execution history, optionally filtered
   */
  async getExecutionHistory(options?: {
    portal?: string;
    limit?: number;
  }): Promise<IExecutionMemory[]> {
    return await this.memoryBank.getExecutionHistory(options?.portal, options?.limit);
  }

  /**
   * Search across all memory banks
   */
  async search(
    query: string,
    options?: { portal?: string; limit?: number },
  ): Promise<IMemorySearchResult[]> {
    return await this.memoryBank.searchMemory(query, options);
  }

  /**
   * List pending memory update proposals
   */
  async listPending(): Promise<IMemoryUpdateProposal[]> {
    return await this.extractor.listPending();
  }

  /**
   * Get a specific pending proposal
   */
  async getPending(proposalId: string): Promise<IMemoryUpdateProposal | null> {
    return await this.extractor.getPending(proposalId);
  }

  /**
   * Approve a pending memory update
   */
  async approvePending(proposalId: string): Promise<void> {
    return await this.extractor.approvePending(proposalId);
  }

  /**
   * Reject a pending memory update
   */
  async rejectPending(proposalId: string, reason: string): Promise<void> {
    return await this.extractor.rejectPending(proposalId, reason);
  }
}
