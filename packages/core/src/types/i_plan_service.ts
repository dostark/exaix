/**
 * @module IplanService
 * @path src/shared/interfaces/i_plan_service.ts
 * @description Module for IplanService.
 * @architectural-layer Shared
 * @related-files [@exaix/core/types]
 */

import type { PlanStatusType } from "@exaix/core/status";

import type { IPlanDetails, IPlanMetadata } from "@exaix/core/types";

export interface IPlanService {
  /**
   * Approve a plan for execution.
   */
  approve(planId: string, reviewer?: string, skills?: string[]): Promise<boolean>;

  /**
   * Reject a plan with a reason.
   */
  reject(planId: string, reviewer?: string, reason?: string): Promise<boolean>;

  /**
   * Request revision of a plan with feedback comments.
   */
  revise(planId: string, comments: string[]): Promise<void>;

  /**
   * List plans, optionally filtered by status.
   */
  list(statusFilter?: PlanStatusType): Promise<IPlanMetadata[]>;

  /**
   * List only pending (review) plans.
   */
  listPending(): Promise<IPlanMetadata[]>;

  /**
   * Show full details of a plan.
   */
  show(planId: string): Promise<IPlanDetails>;

  /**
   * Get the diff of changes proposed in a plan.
   */
  getDiff(planId: string): Promise<string>;
}
