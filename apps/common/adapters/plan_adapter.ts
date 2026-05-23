/**
 * @module PlanAdapter
 * @path apps/common/adapters/plan_adapter.ts
 * @description Module for PlanAdapter.
 * @architectural-layer Services
 * @ungrounded
 * @related-files [apps/exactl/src/commands/plan_commands.ts, "packages/core/src/types/i_plan_service.ts"]
 */

import type { IPlanService } from "@exaix/core/types";
import type { IPlanDetails, IPlanMetadata } from "@exaix/core/types";
import { PlanStatus } from "@exaix/core/status";
import type { PlanStatusType } from "@exaix/core/status";

interface IPlanCommandService {
  approve(planId: string, skills?: string[]): Promise<void>;
  reject(planId: string, reason?: string): Promise<void>;
  revise(planId: string, comments: string[]): Promise<void>;
  list(statusFilter?: PlanStatusType): Promise<IPlanMetadata[]>;
  show(planId: string): Promise<IPlanDetails>;
}

export class PlanAdapter implements IPlanService {
  constructor(private service: IPlanCommandService) {}

  async approve(planId: string, _reviewer?: string, skills?: string[]): Promise<boolean> {
    try {
      await this.service.approve(planId, skills);
      return true;
    } catch {
      return false;
    }
  }

  async reject(planId: string, _reviewer?: string, reason?: string): Promise<boolean> {
    try {
      await this.service.reject(planId, reason || "Rejected via TUI");
      return true;
    } catch {
      return false;
    }
  }

  async revise(planId: string, comments: string[]): Promise<void> {
    await this.service.revise(planId, comments);
  }

  async list(statusFilter?: PlanStatusType): Promise<IPlanMetadata[]> {
    return await this.service.list(statusFilter);
  }

  async listPending(): Promise<IPlanMetadata[]> {
    return await this.list(PlanStatus.REVIEW);
  }

  async show(planId: string): Promise<IPlanDetails> {
    return await this.service.show(planId);
  }

  async getDiff(planId: string): Promise<string> {
    const details = await this.show(planId);
    return `Diff for plan ${planId}:\n\n${details.content}`;
  }
}
