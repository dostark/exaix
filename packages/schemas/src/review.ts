/**
 * @module ReviewSchema
 * @path src/shared/schemas/review.ts
 * @description Defines the structure for code reviews created by agents, including branch metadata, commit SHAs, and rejection reasons.
 * @architectural-layer Schemas
 * @related-files [src/cli/review_commands.ts]
 */

import { z } from "zod";
import { REVIEW_STATUS_VALUES } from "@exaix/core/status";

import type { IReviewStatus } from "@exaix/core/status";

/**
 * Review status values
 */
export const ReviewStatusSchema: z.ZodType<IReviewStatus> = z.enum(REVIEW_STATUS_VALUES);

/**
 * Review schema with all fields
 */
export const ReviewSchema = z.object({
  id: z.string().uuid(), // Review UUID
  trace_id: z.string().uuid(), // Link to request/plan trace
  portal: z.string().nullish(), // Portal name (null for workspace)
  branch: z.string().min(1), // Git branch name (feat/<desc>-<trace>)
  repository: z.string().min(1), // Absolute path to git repository
  base_branch: z.string().nullish(), // Base/target branch to merge into
  worktree_path: z.string().nullish(), // Optional worktree execution path
  status: ReviewStatusSchema, // Current status
  description: z.string(), // Description of changes
  commit_sha: z.string().nullish(), // Latest commit SHA from agent
  files_changed: z.number().int().nonnegative().default(0), // Number of files in commit
  created: z.string().datetime(), // ISO 8601 timestamp
  created_by: z.string().min(1), // Agent blueprint name
  approved_at: z.string().datetime().nullish(), // Approval timestamp
  approved_by: z.string().nullish(), // User who approved
  rejected_at: z.string().datetime().nullish(), // Rejection timestamp
  rejected_by: z.string().nullish(), // User who rejected
  rejection_reason: z.string().nullish(), // Reason for rejection
});

export type IReview = z.infer<typeof ReviewSchema>;

/**
 * Input for registering a new review
 */
export const RegisterReviewSchema = z.object({
  trace_id: z.string().uuid(),
  portal: z.string().nullish(), // Can be null for workspace reviews
  branch: z.string().min(1),
  repository: z.string().min(1), // Absolute path to git repository
  base_branch: z.string().optional(),
  worktree_path: z.string().optional(),
  commit_sha: z.string().optional(),
  files_changed: z.number().int().nonnegative().default(0),
  description: z.string(),
  created_by: z.string().min(1), // Agent name
});

export type IRegisterReviewInput = z.infer<typeof RegisterReviewSchema>;

/**
 * Filters for listing reviews
 */
export const ReviewFiltersSchema = z.object({
  trace_id: z.string().uuid().optional(),
  portal: z.string().optional(),
  status: ReviewStatusSchema.optional(),
  created_by: z.string().optional(),
});

export type IReviewFilters = z.infer<typeof ReviewFiltersSchema>;
