/**
 * @module MemoryCurationCommands
 * @path apps/exactl/src/commands/memory_curation_commands.ts
 * @description Provides the CLI commands that curate memory content: promote and demote a learning, delete a learning and review pending proposals.
 * @architectural-layer CLI
 * @related-files ["apps/exactl/src/commands/memory_commands.ts", "apps/exactl/src/command_builders/memory_command.ts"]
 */

import { BaseCommand } from "@exaix/cli/base.ts";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { MemoryScope, type MemoryType } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { ILearning, IMemoryUpdateProposal } from "@exaix/schemas/memory_bank.ts";
import { MemoryAutoApprovalAdapter } from "../../../../apps/common/adapters/memory_auto_approval_adapter.ts";
import type { IProposalApproval } from "./memory_results.ts";

export class MemoryCurationCommands extends BaseCommand {
  private _autoApprovalService?: MemoryAutoApprovalAdapter;

  private get autoApprovalService(): MemoryAutoApprovalAdapter {
    if (!this._autoApprovalService) {
      this._autoApprovalService = new MemoryAutoApprovalAdapter(this.config, this.extractor);
    }
    return this._autoApprovalService;
  }

  async promote(
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
    try {
      const learningId = await this.memoryBank.promoteLearning(portal, promotion);
      return `ILearning promoted successfully.\nID: ${learningId}\nTitle: ${promotion.title}\nFrom: ${portal} → global`;
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }

  async demote(learningId: string, targetPortal: string): Promise<string> {
    try {
      await this.memoryBank.demoteLearning(learningId, targetPortal);
      return `ILearning demoted successfully.\nID: ${learningId}\nTo: ${targetPortal}`;
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }

  async deleteLearning(learningId: string, reason?: Opt<string, Reason.OptionalInput>): Promise<void> {
    await this.memoryBank.deleteLearning(learningId, reason);
  }

  // Pending Proposals Commands

  async pendingList(eligible = false): Promise<IMemoryUpdateProposal[]> {
    return eligible ? await this.autoApprovalService.listEligible() : await this.extractor.listPending();
  }

  async pendingShow(proposalId: string): Promise<IMemoryUpdateProposal> {
    const proposal = await this.extractor.getPending(proposalId);

    if (!proposal) {
      throw new ExaCtlError(ExaCtlExitCode.NOT_FOUND, `Proposal not found: ${proposalId}`);
    }

    return proposal;
  }

  async pendingApprove(proposalId: string): Promise<IProposalApproval> {
    const proposal = await this.pendingShow(proposalId);
    await this.extractor.approvePending(proposalId);
    return {
      id: proposalId,
      title: proposal.learning.title,
      mergedTo: proposal.target_project || MemoryScope.GLOBAL,
    };
  }

  /** The proposals that the auto-approval rules would approve now. It changes nothing. */
  async pendingApproveDryRun(): Promise<IMemoryUpdateProposal[]> {
    return await this.autoApprovalService.listEligible();
  }

  async pendingReject(proposalId: string, reason: string): Promise<void> {
    await this.pendingShow(proposalId);
    await this.extractor.rejectPending(proposalId, reason);
  }

  /** Approves every pending proposal and skips the ones that fail. It returns the approvals. */
  async pendingApproveAll(): Promise<IProposalApproval[]> {
    const approvals: IProposalApproval[] = [];
    for (const proposal of await this.extractor.listPending()) {
      try {
        approvals.push(await this.pendingApprove(proposal.id || ""));
      } catch {
        // A failed approval is skipped and the others continue.
      }
    }
    return approvals;
  }
}
