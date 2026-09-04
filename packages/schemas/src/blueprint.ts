/**
 * @module BlueprintSchema
 * @path packages/schemas/src/blueprint.ts
 * @description Defines Zod validation schemas for agent blueprint files, including frontmatter and creation results.
 * @architectural-layer Schemas
 * @related-files [apps/exactl/src/commands/blueprint_commands.ts]
 */

import { z } from "zod";
import { DEFAULT_BLUEPRINT_VERSION } from "@exaix/core";
import { ActivityActor, type BlueprintStatus, McpToolName, TaskType, ToolName } from "@exaix/core";
import { HitlPolicySchema } from "./hitl.ts";
import { SessionDelegateConfigSchema } from "./session_delegate.ts";

// Blueprint Interfaces

/**
 * Result from blueprint creation
 */
export interface IBlueprintCreateResult {
  agent_role: string;
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
  agent_role: string;
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

// Blueprint Frontmatter Schema

/**
 * Zod schema for blueprint frontmatter validation
 */
export const BlueprintFrontmatterSchema = z.object({
  /** Unique agent identifier (lowercase alphanumeric + hyphens) */
  agent_role: z.string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "agent_role must be lowercase alphanumeric with hyphens only"),

  /** Human-readable agent name */
  name: z.string().min(1).max(100),

  /** Model in provider:model format. Optional — use model_size + characteristics for
   *  routing-based resolution; empty string or absent means "resolve via ModelResolver". */
  model: z.preprocess(
    (val) => (val === "" ? undefined : val),
    z.string()
      .min(1)
      .regex(/^[a-z]+:[a-z0-9-.:/]+$/, "model must be in provider:model format")
      .optional(),
  ),

  /** Size tier mapped onto task complexity for provider selection. */
  model_size: z.enum(["S", "M", "L", "XL"]).optional(),

  /** Soft ranking hints: cheapest, fastest. */
  characteristics: z.array(z.string()).optional(),

  /** Extended-thinking hint. */
  thinking: z.boolean().optional(),

  /** Reasoning-effort hint. */
  effort: z.string().optional(),

  /** Preferred provider hint. */
  preferred_provider: z.string().optional(),

  /** Agent capabilities */
  capabilities: z.array(z.string()).optional().default([]),

  /** Deprecation flag. When true, routing/capability matching excludes the blueprint from selection. Optional;
   *  absent means active. Single source of truth for lifecycle; `IBlueprintMetadata.status` projects it to
   *  `active` | `deprecated`. */
  deprecated: z.boolean().optional(),

  /** ISO 8601 timestamp */
  created: z.string().datetime(),

  /** User who created the blueprint */
  created_by: z.string(),

  /** Semantic version */
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default(DEFAULT_BLUEPRINT_VERSION),

  /** Optional description */
  description: z.string().optional(),

  /** Routing hint for NL task matching — short action-oriented phrase consumed by routing policy. */
  routing_hint: z.string().optional(),

  /** Default skills to apply to all requests for this agent. */
  default_skills: z.array(z.string()).optional(),

  /** Tools this agent role is permitted to use in dynamic execution steps (from McpToolName or ToolName). Flow
   *  steps may narrow but not expand this set. Omitting this field means no dynamic tool permissions. */
  permitted_tools: z.array(z.union([z.nativeEnum(McpToolName), z.nativeEnum(ToolName)])).optional(),

  /** Per-action HITL governance rules. Optional; absent means no per-action HITL policy. */
  hitl: HitlPolicySchema.optional(),

  /** Session delegation configuration. Overrides portal/global settings. */
  session_delegate: SessionDelegateConfigSchema.optional(),
});

export type IBlueprintFrontmatter = z.infer<typeof BlueprintFrontmatterSchema>;

// Reserved Agent Roles

/**
 * Agent roles that cannot be used for custom blueprints
 */
export const RESERVED_AGENT_ROLES = new Set<string>([
  ActivityActor.SYSTEM,
  TaskType.TEST,
]);

/**
 * Check if agent_role is reserved
 */
export function isReservedAgentRole(agentRole: string): boolean {
  return RESERVED_AGENT_ROLES.has(agentRole);
}
