/**
 * @module RequestSpecificationSchema
 * @path src/shared/schemas/request_specification.ts
 * @description Defines the Zod schema and inferred TypeScript type for the
 * structured request specification produced by the clarification Q&A loop
 * engine (Phase 47). A specification is the compiled, structured output that
 * replaces the raw request body as the contract driving agent execution and
 * evaluation.
 * @architectural-layer Shared
 * * @related-files [src/shared/schemas/mod.ts, src/shared/schemas/clarification_session.ts, src/services/quality_gate/clarification_engine.ts]
 */

import { z } from "zod";

// ============================================================================
// Root schema
// ============================================================================

/**
 * Structured request specification compiled from a clarification Q&A session.
 * Follows the Specification-Driven Development (SDD) methodology.
 */
export const RequestSpecificationSchema = z.object({
  /** Concise summary of what the user wants. */
  summary: z.string().min(1),
  /** Explicit goals extracted from the conversation. */
  goals: z.array(z.string()),
  /** Measurable success criteria. */
  successCriteria: z.array(z.string()),
  /** What is in scope and what is explicitly out. */
  scope: z.object({
    includes: z.array(z.string()),
    excludes: z.array(z.string()),
  }),
  /** Technical or process constraints. */
  constraints: z.array(z.string()),
  /** Additional context that aids execution. */
  context: z.array(z.string()),
  /** Original unmodified request body preserved for audit. */
  originalBody: z.string(),
});

export type IRequestSpecification = z.infer<typeof RequestSpecificationSchema>;
