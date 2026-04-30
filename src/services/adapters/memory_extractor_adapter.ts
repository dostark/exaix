/**
 * @module MemoryExtractorAdapter
 * @path src/services/adapters/memory_extractor_adapter.ts
 * @description Adapter for MemoryExtractorService that satisfies the IMemoryExtractorService interface.
 * @architectural-layer Services/Adapters
 * @related-files ["src/services/memory/memory_extractor.ts", "packages/core/src/types/i_memory_extractor_service.ts"]
 */

import type { IMemoryExtractorService } from "@exaix/core/types";
import type { MemoryExtractorService } from "../memory/memory_extractor.ts";
import type { IExecutionMemory, IMemoryUpdateProposal, IProposalLearning } from "@exaix/schemas/memory_bank.ts";

export class MemoryExtractorAdapter implements IMemoryExtractorService {
  constructor(private inner: MemoryExtractorService) {}

  analyzeExecution(execution: IExecutionMemory): IProposalLearning[] {
    return this.inner.analyzeExecution(execution);
  }

  async createProposal(
    learning: IProposalLearning,
    execution: IExecutionMemory,
    identityId: string,
  ): Promise<string> {
    return await this.inner.createProposal(learning, execution, identityId);
  }

  async listPending(): Promise<IMemoryUpdateProposal[]> {
    return await this.inner.listPending();
  }

  async getPending(proposalId: string): Promise<IMemoryUpdateProposal | null> {
    return await this.inner.getPending(proposalId);
  }

  async approvePending(proposalId: string): Promise<void> {
    return await this.inner.approvePending(proposalId);
  }

  async rejectPending(proposalId: string, reason: string): Promise<void> {
    return await this.inner.rejectPending(proposalId, reason);
  }

  async approveAll(): Promise<number> {
    return await this.inner.approveAll();
  }
}
