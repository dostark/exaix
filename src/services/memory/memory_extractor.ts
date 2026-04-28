/**
 * @module MemoryExtractor
 * @path src/services/memory/memory_extractor.ts
 * @description Analyzes execution results to extract learnings and patterns, managing the lifecycle of pending memory update proposals.
 * @architectural-layer Services
 * * @related-files [src/services/memory/memory_bank.ts, src/services/core/db.ts]
 */

import { DEFAULT_TITLE_PLACEHOLDER, MEMORY_EVENT_AUTO_APPROVED } from "@exaix/core";
import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import type { Config } from "@exaix/schemas/config.ts";
import type { IDatabaseService } from "../core/db.ts";
import type { IMemoryBankService } from "../../shared/interfaces/i_memory_bank_service.ts";
import type { JSONObject } from "@exaix/core/types/json.ts";
import type {
  IExecutionMemory,
  ILearning,
  IMemoryUpdateProposal,
  IPattern,
  IProposalLearning,
} from "@exaix/schemas/memory_bank.ts";
import { MemoryUpdateProposalSchema } from "@exaix/schemas/memory_bank.ts";
import { MemoryOperation, MemoryReferenceType, MemoryScope } from "@exaix/core";
import { MemoryStatus } from "@exaix/core";
import { LearningExtractor } from "../memory/learning_extractor.ts";
import { toSafeJson } from "@exaix/core/types/json.ts";
import type { JSONValue } from "@exaix/core";

/**
 * Memory Extractor Service
 *
 * Analyzes executions and manages memory update proposals.
 */
export class MemoryExtractorService {
  private pendingDir: string;

  constructor(
    private config: Config,
    private db: IDatabaseService,
    private memoryBank: IMemoryBankService,
  ) {
    this.pendingDir = join(config.system?.root || Deno.cwd(), config.paths?.memory || "Memory", "Pending");
  }

  // ===== Extraction Operations =====

  // ===== Extraction Operations =====

  /**
   * Analyze an execution and extract potential learnings
   *
   * @param execution - Completed execution memory
   * @returns Array of extracted learnings (without status, ready for proposal)
   */
  analyzeExecution(execution: IExecutionMemory): IProposalLearning[] {
    return LearningExtractor.extract(execution);
  }
  // ===== Proposal Operations =====

  /**
   * Create a proposal from a learning and write to Pending directory
   *
   * @param learning - The learning to propose
   * @param execution - Source execution
   * @param identityId - Identity that created the learning
   * @returns Proposal ID
   */
  async createProposal(
    learning: IProposalLearning,
    execution: IExecutionMemory,
    identityId: string,
  ): Promise<string> {
    await ensureDir(this.pendingDir);

    const proposal: IMemoryUpdateProposal = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      operation: MemoryOperation.ADD,
      target_scope: learning.scope,
      target_project: learning.project,
      learning: {
        ...learning,
        extracted_at: learning.extracted_at || new Date().toISOString(),
      },
      reason: `Extracted from execution ${execution.trace_id}`,
      identity_id: identityId,
      execution_id: execution.trace_id,
      status: MemoryStatus.PENDING,
    };

    // Validate proposal
    MemoryUpdateProposalSchema.parse(proposal);

    // Write to Pending directory
    const proposalPath = join(this.pendingDir, `${proposal.id}.json`);
    await Deno.writeTextFile(proposalPath, JSON.stringify(proposal, null, 2));

    // Log to IActivity Journal
    this.logActivity({
      event_type: "memory.proposal.created",
      target: learning.project || MemoryScope.GLOBAL,
      metadata: {
        proposal_id: proposal.id,
        learning_title: learning.title,
        category: learning.category,
        identity_id: identityId,
      },
    });

    return proposal.id || "";
  }

  /**
   * List all pending proposals
   *
   * @returns Array of pending proposals
   */
  async listPending(): Promise<IMemoryUpdateProposal[]> {
    const proposals: IMemoryUpdateProposal[] = [];

    if (!await exists(this.pendingDir)) {
      return proposals;
    }

    for await (const entry of Deno.readDir(this.pendingDir)) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        try {
          const content = await Deno.readTextFile(join(this.pendingDir, entry.name));
          const proposal = MemoryUpdateProposalSchema.parse(JSON.parse(content));
          if (proposal.status === MemoryStatus.PENDING) {
            proposals.push(proposal);
          }
        } catch {
          // Skip invalid files
        }
      }
    }

    // Sort by created_at descending
    proposals.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

    return proposals;
  }

  /**
   * Get a specific pending proposal
   *
   * @param proposalId - Proposal ID
   * @returns Proposal or null if not found
   */
  async getPending(proposalId: string): Promise<IMemoryUpdateProposal | null> {
    const proposalPath = join(this.pendingDir, `${proposalId}.json`);

    if (!await exists(proposalPath)) {
      return null;
    }

    try {
      const content = await Deno.readTextFile(proposalPath);
      return MemoryUpdateProposalSchema.parse(JSON.parse(content));
    } catch {
      return null;
    }
  }

  /**
   * Approve a pending proposal and merge the learning
   *
   * @param proposalId - Proposal ID to approve
   */
  async approvePending(proposalId: string, autoApproved = false): Promise<void> {
    const proposal = await this.getPending(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    // Convert proposal learning to full Learning
    const learning: ILearning = {
      ...proposal.learning,
      status: MemoryStatus.APPROVED,
      approved_at: new Date().toISOString(),
    };

    // Add to appropriate scope
    if (proposal.target_scope === MemoryScope.GLOBAL) {
      await this.memoryBank.addGlobalLearning(learning);
    } else if (proposal.target_project) {
      // Add as pattern to project
      const pattern: IPattern = {
        name: learning.title || `${DEFAULT_TITLE_PLACEHOLDER} Learning`,
        description: learning.description || "",
        examples: learning.references?.filter((r: { type: MemoryReferenceType; path: string }) =>
          r.type === MemoryReferenceType.FILE
        ).map((r: { type: MemoryReferenceType; path: string }) =>
          r.path
        ) || [],
        tags: learning.tags,
      };
      await this.memoryBank.addPattern(proposal.target_project, pattern);
    }

    // Remove proposal file
    const proposalPath = join(this.pendingDir, `${proposalId}.json`);
    await Deno.remove(proposalPath);

    // Log approval
    this.logActivity({
      event_type: autoApproved ? MEMORY_EVENT_AUTO_APPROVED : "memory.proposal.approved",
      target: proposal.target_project || MemoryScope.GLOBAL,
      metadata: {
        proposal_id: proposalId,
        learning_title: proposal.learning?.title || DEFAULT_TITLE_PLACEHOLDER,
      },
    });
  }

  /**
   * Reject a pending proposal
   *
   * @param proposalId - Proposal ID to reject
   * @param reason - Rejection reason
   */
  async rejectPending(proposalId: string, reason: string): Promise<void> {
    const proposal = await this.getPending(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    // Remove proposal file
    const proposalPath = join(this.pendingDir, `${proposalId}.json`);
    await Deno.remove(proposalPath);

    // Log rejection
    this.logActivity({
      event_type: "memory.proposal.rejected",
      target: proposal.target_project || MemoryScope.GLOBAL,
      metadata: {
        proposal_id: proposalId,
        learning_title: proposal.learning?.title || DEFAULT_TITLE_PLACEHOLDER,
        reason,
      },
    });
  }

  /**
   * Approve all pending proposals
   *
   * @returns Number of proposals approved
   */
  async approveAll(): Promise<number> {
    const pending = await this.listPending();
    let approved = 0;

    for (const proposal of pending) {
      try {
        await this.approvePending(proposal.id || "");
        approved++;
      } catch {
        // Skip failed approvals, continue with others
      }
    }

    return approved;
  }

  // ===== Private Helpers =====

  /**
   * Log activity to IActivity Journal
   */
  private logActivity(event: {
    event_type: string;
    target: string;
    trace_id?: string;
    metadata?: JSONObject;
  }): void {
    try {
      this.db.logActivity(
        "memory-extractor",
        event.event_type,
        event.target,
        toSafeJson(event.metadata) as Record<string, JSONValue>,
        event.trace_id,
      );
    } catch {
      // Don't fail on logging errors
    }
  }
}
