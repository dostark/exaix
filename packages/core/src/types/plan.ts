/**
 * @module Plan
 * @path packages/core/src/types/plan.ts
 * @description Module for Plan.
 * @architectural-layer Shared
 * @related-files ["packages/core/src/types/i_plan_service.ts"]
 */

import type { PlanStatusType } from "@exaix/core/status";

/**
 * Metadata for a plan, including its current status and related request info.
 */
export interface IPlanMetadata {
  id: string; // The filename (e.g., plan.md)
  status: PlanStatusType;
  trace_id?: string;
  agent_role?: string;
  author?: string;
  request_id?: string;
  request_subject?: string;
  request_agent_role?: string;
  request_portal?: string;
  request_priority?: string;
  request_created_by?: string;
  input_tokens?: string;
  output_tokens?: string;
  total_tokens?: string;
  token_provider?: string;
  token_model?: string;
  token_cost_usd?: string;
  created_at?: string;
  approved_by?: string;
  approved_at?: string;
  rejected_by?: string;
  rejected_at?: string;
  rejection_reason?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  subject?: string;
}

/**
 * Full details of a plan, including its markdown content.
 */
export interface IPlanDetails {
  metadata: IPlanMetadata;
  content: string;
}
