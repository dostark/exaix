/**
 * @module MemoryAdapter
 * @path apps/common/adapters/memory_adapter.ts
 * @description Adapter implementing IMemoryService by delegating to MemoryBankService and MemoryExtractorService.
 * @architectural-layer Services
 * @related-files ["packages/memory/src/bank/memory_bank.ts", "packages/memory/src/extraction/memory_extractor.ts", @exaix/core/types]
 */

import type { IMemoryService, Opt, Reason } from "@exaix/core/types";
import type { MemoryBankService } from "@exaix/memory";
import type { MemoryExtractorService } from "@exaix/memory";
import type {
  IExecutionMemory,
  IGlobalMemory,
  IMemorySearchResult,
  IMemoryUpdateProposal,
  IProjectMemory,
} from "@exaix/schemas/memory_bank.ts";

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
  async getExecutionHistory(
    options?: Opt<{
      portal?: string;
      limit?: number;
    }, Reason.QueryFilter>,
  ): Promise<IExecutionMemory[]> {
    return await this.memoryBank.getExecutionHistory(options?.portal, options?.limit);
  }

  /**
   * Search across all memory banks
   */
  async search(
    query: string,
    options?: Opt<{ portal?: string; limit?: number }, Reason.QueryFilter>,
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
