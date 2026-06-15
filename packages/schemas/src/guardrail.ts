/**
 * @module GuardrailSchemas
 * @path packages/schemas/src/guardrail.ts
 * @description Zod schemas for the concurrent guardrail runner configuration, policies, and incidents (Phase 107).
 * @architectural-layer Shared
 * @related-files [packages/schemas/src/config.ts]
 */

import { z } from "zod";

/** A violation either warns (journaled, execution continues) or blocks (halts via amendment). */
export const GuardrailSeveritySchema = z.enum(["warn", "block"]);
export type GuardrailSeverity = z.infer<typeof GuardrailSeveritySchema>;

export const GuardrailVerdictSchema = z.enum(["pass", "violation"]);
export type GuardrailVerdict = z.infer<typeof GuardrailVerdictSchema>;

/** One screening policy, evaluated by a fast-slot model against the agent output. */
export const GuardrailPolicySchema = z.object({
  policy_id: z.string().min(1),
  description: z.string().min(1),
  /** Blueprint that performs the policy evaluation. */
  blueprint: z.string().min(1),
  /** Forward-compat slot hint; v1 uses the injected screening provider regardless. */
  model_slot: z.enum(["default", "fast", "local"]).default("fast"),
  severity: GuardrailSeveritySchema.default("block"),
});
export type GuardrailPolicy = z.infer<typeof GuardrailPolicySchema>;

/** [guardrail] config block — optional on ConfigSchema, disabled by default. */
export const GuardrailConfigSchema = z.object({
  enabled: z.boolean().default(false),
  policies: z.array(GuardrailPolicySchema).default([]),
  /** Screen every Nth ReAct iteration (1 = every iteration). */
  check_interval_iterations: z.number().int().positive().default(1),
  /** Also screen the final output before it reaches the Review gate. */
  screen_final_output: z.boolean().default(true),
});
export type GuardrailConfig = z.infer<typeof GuardrailConfigSchema>;

/** One screening outcome, journaled via EventLogger. */
export const GuardrailIncidentSchema = z.object({
  trace_id: z.string().uuid(),
  policy_id: z.string().min(1),
  iteration: z.number().int().nonnegative(),
  verdict: GuardrailVerdictSchema,
  severity: GuardrailSeveritySchema,
  /** Bounded excerpt of the output that triggered the violation (GUARDRAIL_FLAGGED_EXCERPT_MAX_CHARS). */
  flagged_excerpt: z.string().optional(),
  /** Guardrail model's explanation. */
  explanation: z.string().optional(),
});
export type GuardrailIncident = z.infer<typeof GuardrailIncidentSchema>;
