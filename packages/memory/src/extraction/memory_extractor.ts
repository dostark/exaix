/**
 * @module MemoryExtractor
 * @path packages/memory/src/extraction/memory_extractor.ts
 * @description Analyzes execution results to extract learnings and patterns, managing the lifecycle of pending memory update proposals.
 * @architectural-layer Services
 * @related-files [packages/memory/src/bank/memory_bank.ts, packages/core/src/types/i_database_service.ts]
 */

import {
  DEFAULT_TITLE_PLACEHOLDER,
  MemoryExtractionMethod,
  MemoryOperation,
  MemoryReferenceType,
  MemoryScope,
} from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { MemoryStatus } from "@exaix/core/status";
import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import type { Config } from "@exaix/schemas/config.ts";
import type { IDatabaseService } from "@exaix/core";
import type { IExtractionStrategy, IMemoryBankService, IMemoryCostRouter, Opt, Reason } from "@exaix/core/types";
import type {
  IExecutionMemory,
  ILearning,
  IMemoryUpdateProposal,
  IPattern,
  IProposalLearning,
} from "@exaix/schemas/memory_bank.ts";
import { MemoryUpdateProposalSchema } from "@exaix/schemas/memory_bank.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { HeuristicExtractionStrategy } from "./heuristic_extraction_strategy.ts";

export interface IMemoryExtractorOptions {
  costRouter?: Opt<IMemoryCostRouter, Reason.OptionalDependency>;
  llmStrategy?: Opt<IExtractionStrategy, Reason.OptionalDependency>;
  heuristicStrategy?: Opt<IExtractionStrategy, Reason.SensibleDefault>;
  /** Invoked after a proposal is approved (manual or auto) with the APPROVED learning —
   *  the single seam feeding session/tiered memory, gated behind review. */
  onApproved?: Opt<(learning: ILearning) => Promise<void> | void, Reason.OptionalDependency>;
}

export class MemoryExtractorService {
  private pendingDir: string;

  constructor(
    private config: Config,
    private db: IDatabaseService,
    private memoryBank: IMemoryBankService,
    private logger?: Opt<IEventLogger, Reason.OptionalDependency>,
    private options: IMemoryExtractorOptions = {},
  ) {
    this.pendingDir = join(config.system?.root || Deno.cwd(), config.paths?.memory || "Memory", "Pending");
  }

  // Extraction Operations

  // Extraction Operations

  async analyzeExecution(execution: IExecutionMemory): Promise<IProposalLearning[]> {
    const remoteAllowed = this.options.costRouter && this.options.llmStrategy
      ? await this.options.costRouter.isRemoteAllowed()
      : false;
    const method = remoteAllowed ? MemoryExtractionMethod.LLM : MemoryExtractionMethod.HEURISTIC;
    const strategy = remoteAllowed
      ? this.options.llmStrategy!
      : this.options.heuristicStrategy ?? new HeuristicExtractionStrategy();
    const learnings = await strategy.extract(execution);
    for (const learning of learnings) {
      await this.logger?.info(DomainEventType.MemoryLearningExtracted, learning.project ?? MemoryScope.GLOBAL, {
        extraction_method: method,
        quality_score: learning.quality_score,
        learning_id: learning.id,
      });
    }
    return learnings;
  }
  // Proposal Operations

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
    this.logger?.info(
      DomainEventType.MemoryProposalCreated,
      learning.project || MemoryScope.GLOBAL,
      {
        proposal_id: proposal.id,
        learning_title: learning.title,
        category: learning.category,
        identity_id: identityId,
      },
    );

    return proposal.id || "";
  }

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

    // Tiered-memory feed: reviewed content only — invoked after the durable write.
    await this.options.onApproved?.(learning);

    // Log approval
    this.logger?.info(
      autoApproved ? DomainEventType.MemoryAutoApproved : DomainEventType.MemoryProposalApproved,
      proposal.target_project || MemoryScope.GLOBAL,
      {
        proposal_id: proposalId,
        learning_title: proposal.learning?.title || DEFAULT_TITLE_PLACEHOLDER,
      },
    );
  }

  async rejectPending(proposalId: string, reason: string): Promise<void> {
    const proposal = await this.getPending(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    // Remove proposal file
    const proposalPath = join(this.pendingDir, `${proposalId}.json`);
    await Deno.remove(proposalPath);

    // Log rejection
    this.logger?.info(
      DomainEventType.MemoryProposalRejected,
      proposal.target_project || MemoryScope.GLOBAL,
      {
        proposal_id: proposalId,
        learning_title: proposal.learning?.title || DEFAULT_TITLE_PLACEHOLDER,
        reason,
      },
    );
  }

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
}
