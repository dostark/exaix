/**
 * @module HitlSchema
 * @path packages/schemas/src/hitl.ts
 * @description Zod schemas for the Phase 118 per-action HITL governance layer.
 * Defines HitlRuleSchema (a single policy rule) and HitlPolicySchema (the
 * require_secondary_approval block). Imported by both blueprint.ts and config.ts.
 * @architectural-layer Schemas
 * @dependencies ["zod"]
 * @related-files [packages/schemas/src/blueprint.ts, packages/schemas/src/config.ts]
 */

import { z } from "zod";
import { canonicalizeToolName, McpToolName, ToolName } from "@exaix/core";

const CANONICAL_TOOL_NAMES = new Set<string>([...Object.values(McpToolName), ...Object.values(ToolName)]);

export const HitlRuleSchema = z.object({
  /** Preprocessed through canonicalizeToolName so a stored rule naming a supported
   *  general-purpose alias (`Write`) still requires approval for `write_file`. Native
   *  case/whitespace variants and retired native names never canonicalize, so they still
   *  fail the membership check below (third-review GAP-1). */
  tool: z.preprocess(
    (tool) => typeof tool === "string" ? canonicalizeToolName(tool) : tool,
    z.string().min(1).refine((tool) => CANONICAL_TOOL_NAMES.has(tool), "Tool name must be canonical"),
  ),
  branch_pattern: z.string().optional(),
  path_pattern: z.string().optional(),
  command_pattern: z.string().optional(),
  tables: z.array(z.string()).optional(),
  reason: z.string().optional(),
}).strict();

export const HitlPolicySchema = z.object({
  require_secondary_approval: z.array(HitlRuleSchema).default([]),
});

export type HitlRule = z.infer<typeof HitlRuleSchema>;
export type HitlPolicy = z.infer<typeof HitlPolicySchema>;
