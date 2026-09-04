/**
 * @module StepManifestSchema
 * @path packages/schemas/src/step_manifest.ts
 * @description Zod schema for phase plan step-manifests (fenced YAML blocks within
 *   phase-NN-*.md documents). Validates authoring fields: step number, title,
 *   agent_role, skills, portal, target_branch, depends_on, and acceptance criteria.
 * @architectural-layer Shared
 * @dependencies [zod]
 * @related-files [packages/schemas/src/request.ts]
 */

import { z } from "zod";

/** Distinct from RequestSchema — shares only the `skills` field. Maps directly to
 *  the generated request's `agent_role` frontmatter field. */
export const StepManifestSchema = z.object({
  /** 1-based step number (must be positive integer) */
  step: z.number().int().positive(),

  /** Short step title (1–200 chars) */
  title: z.string().min(1).max(200),

  /** Agent role to route the step request (defaults to senior-coder) */
  agent_role: z.string().min(1).default("senior-coder"),

  /** Explicit skills to inject (merged with agent-role default_skills by agent_runner) */
  skills: z.array(z.string()).optional(),

  /** Portal alias for the step's scope */
  portal: z.string().min(1).optional(),

  /** Git branch for the step's changes */
  target_branch: z.string().min(1).optional(),

  /** Step numbers this step depends on (sequential when absent) */
  depends_on: z.array(z.number().int().positive()).optional(),

  /** Acceptance criteria: test names + expected outcomes */
  acceptance: z.object({
    tests: z.array(z.string()).optional(),
    outcomes: z.array(z.string()).optional(),
  }).optional(),
});

export type StepManifest = z.infer<typeof StepManifestSchema>;
