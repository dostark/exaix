/**
 * @module IMemoryExtractorService
 * @path packages/core/src/types/i_memory_extractor_service.ts
 * @description Interface for memory extraction and update proposal management.
 * @architectural-layer Shared
 * @related-files [apps/common/adapters/memory_extractor_adapter.ts, packages/cli/src/types/cli_context.ts]
 */

import type { IExecutionMemory, IMemoryUpdateProposal, IProposalLearning } from "@exaix/schemas";

export interface IMemoryExtractorService {
  /**
   * Analyze an execution and extract potential learnings.
   */
  analyzeExecution(execution: IExecutionMemory): Promise<IProposalLearning[]>;

  /**
   * Create a proposal from a learning and write to Pending directory.
   */
  createProposal(
    learning: IProposalLearning,
    execution: IExecutionMemory,
    agentRole: string,
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
