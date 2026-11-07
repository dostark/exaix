/**
 * @module MemoryApprovalReader
 * @path apps/exactl/src/commands/memory_approval_reader.ts
 * @description Reads the memory items that wait for a human decision: proposals of the memory extractor and draft skills.
 * @architectural-layer CLI
 * @dependencies ["apps/exactl/src/commands/memory_commands.ts", "@exaix/cli/base.ts"]
 * @related-files ["apps/exactl/src/commands/approval_sources.ts", "apps/exactl/src/exactl.ts"]
 */

import { SkillStatus } from "@exaix/core";
import { BaseCommand } from "@exaix/cli/base.ts";
import type { Opt, Reason } from "@exaix/core/types";
import type { IMemoryUpdateProposal, ISkill } from "@exaix/schemas/memory_bank.ts";
import { cliSkillContext } from "./memory_commands.ts";

export class MemoryApprovalReader extends BaseCommand {
  /** Proposals that wait for a human decision. */
  async listPendingProposals(): Promise<IMemoryUpdateProposal[]> {
    return await this.extractor.listPending();
  }

  /** Draft skills visible to the CLI. No portal lists the skills of no portal context. */
  async listDraftSkills(portal: Opt<string, Reason.OptionalInput>): Promise<ISkill[]> {
    await this.skills.initialize();
    return await this.skills.listSkills({ status: SkillStatus.DRAFT }, cliSkillContext(this.skills, portal));
  }
}
