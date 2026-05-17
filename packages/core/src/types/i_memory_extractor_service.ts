/**
 * @module IMemoryExtractorService
 * @path src/shared/interfaces/i_memory_extractor_service.ts
 * @description Interface for memory extraction and update proposal management.
 * @architectural-layer Shared
 * @related-files [src/services/adapters/memory_extractor_adapter.ts, src/cli/cli_context.ts]
 */

import type { IExecutionMemory, IMemoryUpdateProposal, IProposalLearning } from "@exaix/schemas";

export interface IMemoryExtractorService {
  /**
   * Analyze an execution and extract potential learnings.
   */
  analyzeExecution(execution: IExecutionMemory): IProposalLearning[];

  /**
   * Create a proposal from a learning and write to Pending directory.
   */
  createProposal(
    learning: IProposalLearning,
    execution: IExecutionMemory,
    identityId: string,
  ): Promise<string>;

  /**
   * List all pending memory update proposals.
   */
  listPending(): Promise<IMemoryUpdateProposal[]>;

  /**
   * Get a specific pending proposal.
   */
  getPending(proposalId: string): Promise<IMemoryUpdateProposal | null>;

  /**
   * Approve a pending memory update.
   */
  approvePending(proposalId: string, autoApproved?: boolean): Promise<void>;

  /**
   * Reject a pending proposal.
   */
  rejectPending(proposalId: string, reason: string): Promise<void>;

  /**
   * Approve all pending proposals.
   */
  approveAll(): Promise<number>;
}
