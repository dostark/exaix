/**
 * @module IMemoryService
 * @path packages/core/src/types/i_memory_service.ts
 * @description Formal service interface for High-level Memory operations consumed by the TUI.
 * @architectural-layer Shared
 * @related-files [src/services/adapters/memory_adapter.ts, src/shared/schemas/memory_bank.ts]
 */

import type {
  IExecutionMemory,
  IGlobalMemory,
  IMemorySearchResult,
  IMemoryUpdateProposal,
  IProjectMemory,
} from "@exaix/schemas/memory_bank.ts";

/**
 * Service interface for High-level Memory operations consumed by the TUI.
 */
export interface IMemoryService {
  /** Get list of project names (aliases) */
  getProjects(): Promise<string[]>;

  /** Get memory content for a specific project */
  getProjectMemory(portal: string): Promise<IProjectMemory | null>;

  /** Get global memory bank content */
  getGlobalMemory(): Promise<IGlobalMemory | null>;

  /** Get an execution record by its trace ID */
  getExecutionByTraceId(traceId: string): Promise<IExecutionMemory | null>;

  /** Get execution history, optionally filtered */
  getExecutionHistory(options?: {
    portal?: string;
    limit?: number;
  }): Promise<IExecutionMemory[]>;

  /** Search across all memory banks */
  search(
    query: string,
    options?: { portal?: string; limit?: number },
  ): Promise<IMemorySearchResult[]>;

  /** List pending memory update proposals */
  listPending(): Promise<IMemoryUpdateProposal[]>;

  /** Get a specific pending proposal */
  getPending(proposalId: string): Promise<IMemoryUpdateProposal | null>;

  /** Approve a pending memory update */
  approvePending(proposalId: string): Promise<void>;

  /** Reject a pending memory update */
  rejectPending(proposalId: string, reason: string): Promise<void>;
}
