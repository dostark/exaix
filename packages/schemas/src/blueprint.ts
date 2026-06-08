/**
 * @module BlueprintSchema
 * @path packages/schemas/src/blueprint.ts
 * @description Defines Zod validation schemas for agent blueprint files, including frontmatter and creation results.
 * @architectural-layer Schemas
 * @related-files [apps/exactl/src/commands/blueprint_commands.ts]
 */

import { z } from "zod";
import { DEFAULT_BLUEPRINT_VERSION } from "@exaix/core";
import { ActivityActor, type BlueprintStatus, McpToolName, TaskType } from "@exaix/core";

// ============================================================================
// Blueprint Interfaces
// ============================================================================

/**
 * Result from blueprint creation
 */
export interface IBlueprintCreateResult {
  identity_id: string;
  name: string;
  model: string;
  capabilities?: string[];
  created: string;
  created_by: string;
  version: string;
  path: string;
}

/**
 * Metadata for blueprint listing
 */
export interface IBlueprintMetadata {
  identity_id: string;
  name: string;
  model: string;
  capabilities?: string[];
  status: BlueprintStatus;
  created: string;
  created_by: string;
  version: string;
}

/**
 * Full blueprint details for show command
 */
export interface IBlueprintDetails extends IBlueprintMetadata {
  content: string; // Full markdown content including frontmatter
}

/**
 * Validation result
 */
export interface IBlueprintValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

// ============================================================================
// Blueprint Frontmatter Schema
// ============================================================================

/**
 * Zod schema for blueprint frontmatter validation
 */
export const BlueprintFrontmatterSchema = z.object({
  /** Unique agent identifier (lowercase alphanumeric + hyphens) */
  identity_id: z.string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "identity_id must be lowercase alphanumeric with hyphens only"),

  /** Human-readable agent name */
  name: z.string().min(1).max(100),

  /** Model in provider:model format */
  model: z.string()
    .min(1)
    .regex(/^[a-z]+:[a-z0-9-.:]+$/, "model must be in provider:model format"),

  /** Agent capabilities */
  capabilities: z.array(z.string()).optional().default([]),

  /**
   * Deprecation flag (Phase 93 Solo salvage). When true, routing/capability
   * matching excludes the blueprint from selection (see
   * `packages/routing/src/capability_matcher.ts`). Optional; absent means active.
   * This is the single source of truth for lifecycle; the derived `status` view
   * on `IBlueprintMetadata` projects it to `active` | `deprecated`.
   */
  deprecated: z.boolean().optional(),

  /** ISO 8601 timestamp */
  created: z.string().datetime(),

  /** User who created the blueprint */
  created_by: z.string(),

  /** Semantic version */
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default(DEFAULT_BLUEPRINT_VERSION),

  /** Optional description */
  description: z.string().optional(),

  /** Default skills to apply to all requests for this agent (Phase 17) */
  default_skills: z.array(z.string()).optional(),

  /**
   * Tools this identity is permitted to use in dynamic execution steps (Phase 56).
   * Flow steps may narrow but not expand this set.
   * Omitting this field means the identity has no dynamic tool permissions.
   */
  permitted_tools: z.array(z.nativeEnum(McpToolName)).optional(),
});

export type IBlueprintFrontmatter = z.infer<typeof BlueprintFrontmatterSchema>;

// ============================================================================
// Reserved Agent IDs
// ============================================================================

/**
 * Agent IDs that cannot be used for custom blueprints
 */
export const RESERVED_AGENT_IDS = new Set<string>([
  ActivityActor.SYSTEM,
  TaskType.TEST,
]);

/**
 * Check if identity_id is reserved
 */
export function isReservedAgentId(identityId: string): boolean {
  return RESERVED_AGENT_IDS.has(identityId);
}
