/**
 * @module MemoryAutoApprovalService
 * @path src/services/memory/memory_auto_approval_service.ts
 * @description Manages the automated approval and promotion of high-confidence agent learnings.
 * Implements filtering by source, confidence threshold, and quiet-period delay.
 * @architectural-layer Services
 * * @related-files [src/services/memory/memory_extractor.ts, src/shared/schemas/config.ts]
 */

import type { Config } from "@exaix/schemas/config.ts";
import { ConfidenceAssessmentLevel } from "../../shared/enums.ts";
import type { IMemoryUpdateProposal, IProposalLearning } from "@exaix/schemas/memory_bank.ts";
import type { IMemoryExtractorService } from "../../shared/interfaces/i_memory_extractor_service.ts";

export type IEligibleMemoryUpdateProposal = IMemoryUpdateProposal & {
  learning: IProposalLearning & { eligible_at: string };
};

/**
 * Result of an auto-approval run
 */
export interface IAutoApprovalResult {
  runAt: string;
  promoted: string[];
  skipped: string[];
  dryRun: boolean;
}

/**
 * Service for handling automated memory promotion
 */
export class MemoryAutoApprovalService {
  private readonly config: Config["memory"]["auto_approve"];

  // Numeric mapping for confidence comparison
  private readonly confidenceScores: Record<ConfidenceAssessmentLevel, number> = {
    [ConfidenceAssessmentLevel.VERY_LOW]: 1,
    [ConfidenceAssessmentLevel.LOW]: 2,
    [ConfidenceAssessmentLevel.MEDIUM]: 3,
    [ConfidenceAssessmentLevel.HIGH]: 4,
    [ConfidenceAssessmentLevel.VERY_HIGH]: 5,
  };

  constructor(
    config: Config,
    private readonly memoryExtractor: IMemoryExtractorService,
  ) {
    this.config = config.memory.auto_approve;
  }

  /**
   * List pending proposals that are eligible for auto-approval
   *
   * @returns List of eligible proposals
   */
  async listEligible(): Promise<IEligibleMemoryUpdateProposal[]> {
    if (!this.config.enabled) {
      return [];
    }

    const pending = await this.memoryExtractor.listPending();
    const now = new Date();
    const thresholdScore = this.getConfidenceScore(this.config.confidence_threshold) || 4;
    const allowedSources = this.buildAllowedSources();

    const eligible = pending.filter((proposal) => {
      // 1. Must be from a configured allowed source
      if (!allowedSources.has(proposal.learning.source.toLowerCase())) {
        return false;
      }

      // 2. Must meet confidence threshold
      const proposalScore = this.getConfidenceScore(proposal.learning.confidence);
      if (proposalScore < thresholdScore) {
        return false;
      }

      // 3. Must be older than delay_hours
      if (!proposal.learning.extracted_at) {
        return false; // Safety check
      }

      const extractedAt = new Date(proposal.learning.extracted_at);
      const diffMs = now.getTime() - extractedAt.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      return diffHours >= this.config.delay_hours;
    });

    return eligible.map((proposal) => {
      const extractedAt = proposal.learning.extracted_at ? new Date(proposal.learning.extracted_at) : null;
      const eligibleAt = extractedAt
        ? new Date(extractedAt.getTime() + this.config.delay_hours * 60 * 60 * 1000).toISOString()
        : new Date().toISOString();

      return {
        ...proposal,
        learning: {
          ...proposal.learning,
          eligible_at: eligibleAt,
        },
      } as IEligibleMemoryUpdateProposal;
    });
  }

  private buildAllowedSources(): Set<string> {
    const allowedSources = new Set<string>();

    for (const source of this.config.sources_allowed) {
      const normalized = String(source).toUpperCase();

      if (normalized === "AGENT") {
        allowedSources.add("agent");
        allowedSources.add("execution");
        allowedSources.add("llm");
        allowedSources.add("learned");
      } else {
        allowedSources.add(normalized.toLowerCase());
      }
    }

    return allowedSources;
  }

  private getConfidenceScore(value: string | undefined): number {
    if (!value) {
      return 0;
    }

    const normalized = String(value).toLowerCase() as ConfidenceAssessmentLevel;
    return this.confidenceScores[normalized] || 0;
  }

  /**
   * Run the approval cycle to promote eligible learnings
   *
   * @param opts - Run options (e.g., dryRun)
   * @returns Summary of the run
   */
  async runApprovalCycle(opts: { dryRun: boolean } = { dryRun: false }): Promise<IAutoApprovalResult> {
    const eligible = await this.listEligible();
    const runAt = new Date().toISOString();

    const promoted: string[] = [];
    const skippedByBatch: string[] = [];

    // Sort by extracted_at (process oldest first)
    eligible.sort((a, b) => (a.learning.extracted_at ?? "").localeCompare(b.learning.extracted_at ?? ""));

    // Apply batch limit
    const toProcess = eligible.slice(0, this.config.max_batch_size);
    const remainder = eligible.slice(this.config.max_batch_size);
    remainder.forEach((p) => skippedByBatch.push(p.id!));

    if (!opts.dryRun) {
      for (const proposal of toProcess) {
        try {
          await this.memoryExtractor.approvePending(proposal.id!, true);
          promoted.push(proposal.id!);
        } catch (error) {
          console.error(`[AutoApproval] Failed to approve proposal ${proposal.id}:`, error);
        }
      }
    } else {
      toProcess.forEach((p) => promoted.push(p.id!));
    }

    return {
      runAt,
      promoted,
      skipped: skippedByBatch,
      dryRun: opts.dryRun,
    };
  }
}
