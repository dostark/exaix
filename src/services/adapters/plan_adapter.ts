/**
 * @module PlanAdapter
 * @path src/services/adapters/plan_adapter.ts
 * @description Module for PlanAdapter.
 * @architectural-layer Services
 * * @related-files [src/cli/commands/plan_commands.ts, src/shared/interfaces/i_plan_service.ts]
 */

import type { IPlanService } from "../../shared/interfaces/i_plan_service.ts";
import type { IPlanDetails, IPlanMetadata } from "../../shared/types/plan.ts";
import { PlanStatus, type PlanStatusType } from "@exaix/core";

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
