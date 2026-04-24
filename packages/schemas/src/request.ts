/**
 * @module RequestSchema
 * @path src/shared/schemas/request.ts
 * @description Defines Zod validation schema for agent request frontmatter (YAML), supporting trace IDs, status, priority, and skill overrides.
 * @architectural-layer Schemas
 * * @related-files [src/cli/handlers/request_create_handler.ts]
 */

import { z } from "zod";
import { REQUEST_STATUS_VALUES } from "@exaix/core/shared/status/request_status.ts";

/**
 * Schema for Exaix request frontmatter
 *
 * Validates the YAML frontmatter structure in request markdown files
 * located in Workspace/Requests
 *
 * Uses --- delimiters for YAML (Dataview compatible)
 */
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
  /** Skills to skip/disable for this request */
  skip_skills: z.array(z.string()).optional(),
});

export type Request = z.infer<typeof RequestSchema>;
