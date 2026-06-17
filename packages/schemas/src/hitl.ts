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

export const HitlRuleSchema = z.object({
  tool: z.string().min(1),
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
