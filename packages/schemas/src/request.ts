/**
 * @module RequestSchema
 * @path packages/schemas/src/request.ts
 * @description Defines Zod validation schema for agent request frontmatter (YAML), supporting trace IDs, status, priority, and skill overrides.
 * @architectural-layer Schemas
 * @related-files [apps/exactl/src/handlers/request_create_handler.ts]
 */

import { z } from "zod";
import { REQUEST_STATUS_VALUES } from "@exaix/core/status";

/**
 * Schema for Exaix request frontmatter
 *
 * Validates the YAML frontmatter structure in request markdown files
 * located in Workspace/Requests
 *
 * Uses --- delimiters for YAML (Dataview compatible)
 */
/**
 * Worktree-relative pointer to a Phase-173 PlanContext sandbox copy
 * (`.exa/PlanContext/<slug>.md`), stamped only by `scripts/plan_to_requests.ts` when it
 * copies the source plan under `--plan-context-root` (Phase 174 Step 2 GAP-1).
 */
export const PlanContextRefSchema = z.string().regex(
  /^\.exa\/PlanContext\/[A-Za-z0-9._-]+\.md$/,
);

export const RequestSchema = z.object({
  trace_id: z.string().uuid("Invalid trace_id: must be a valid UUID"),
  identity_id: z.string().min(1, "identity_id cannot be empty"),
  agent_kind: z.string().min(0).optional(),
  status: z.enum(REQUEST_STATUS_VALUES),
  priority: z.number().int().min(0).max(10).default(5),
  created_at: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),

  /** Explicit skills to apply for this request (overrides trigger matching) */
  skills: z.array(z.string()).optional(),

  /** Provenance for a session_delegate_cycle flow request; omitted for all other requests. */
  plan_context_ref: PlanContextRefSchema.optional(),
});

export type Request = z.infer<typeof RequestSchema>;
