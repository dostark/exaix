/**
 * @module ClarificationSessionSchema
 * @path packages/schemas/src/clarification_session.ts
 * @description Defines Zod schemas and inferred TypeScript types for the
 * clarification Q&A loop data model used by the RequestQualityGate service
 * (Phase 47). Captures multi-round conversation state between the planning
 * agent and the user, including questions, answers, refined body, and quality
 * score progression.
 * @architectural-layer Shared
 * @related-files [packages/schemas/src/mod.ts, packages/schemas/src/request_specification.ts, packages/quality-gate/src/clarification_engine.ts]
 */

import { z } from "zod";
import { RequestSpecificationSchema } from "./request_specification.ts";

// ============================================================================
// Enums
// ============================================================================

/**
 * Category of information a clarification question seeks to gather.
 */
export enum ClarificationQuestionCategory {
  GOAL = "goal",
  SCOPE = "scope",
  CONSTRAINT = "constraint",
  ACCEPTANCE = "acceptance",
  CONTEXT = "context",
  PRIORITY = "priority",
}

/**
 * Terminal and intermediate states of a clarification session lifecycle.
 */
export enum ClarificationSessionStatus {
  ACTIVE = "active",
  USER_CONFIRMED = "user-confirmed",
  AGENT_SATISFIED = "agent-satisfied",
  MAX_ROUNDS = "max-rounds",
  USER_CANCELLED = "user-cancelled",
}

// ============================================================================
// Sub-schemas
// ============================================================================

/**
 * A single question asked by the planning agent within a clarification round.
 */
export const ClarificationQuestionSchema = z.object({
  /** Unique question ID within this round. */
  id: z.string().min(1),
  /** The question text presented to the user. */
  question: z.string().min(1),
  /** Rationale explaining why this information is needed. */
  rationale: z.string().min(1),
  /** Category of information this question seeks to fill. */
  category: z.nativeEnum(ClarificationQuestionCategory),
  /** Whether answering this question is mandatory to proceed. */
  required: z.boolean(),
});

export type IClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>;

/**
 * A single round of the Q&A loop — questions generated and optionally answered.
 */
export const ClarificationRoundSchema = z.object({
  /** Round number (1-based). */
  round: z.number().int().min(1),
  /** Questions asked by the planning agent in this round. */
  questions: z.array(ClarificationQuestionSchema),
  /** User answers keyed by question ID (absent until user responds). */
  answers: z.record(z.string(), z.string()).optional(),
  /** ISO 8601 timestamp when questions were generated. */
  askedAt: z.string(),
  /** ISO 8601 timestamp when the user responded. */
  answeredAt: z.string().optional(),
});

export type IClarificationRound = z.infer<typeof ClarificationRoundSchema>;

/**
 * Quality score snapshot for a single round, used to track improvement.
 */
export const QualityHistoryEntrySchema = z.object({
  round: z.number().int().min(0),
  score: z.number().int().min(0).max(100),
  level: z.string().min(1),
});

export type IQualityHistoryEntry = z.infer<typeof QualityHistoryEntrySchema>;

// ============================================================================
// Root schema
// ============================================================================

/**
 * Full state of a clarification session for a single request.
 */
export const ClarificationSessionSchema = z.object({
  /** ID of the request being refined. */
  requestId: z.string().min(1),
  /** Original unmodified request body (never overwritten). */
  originalBody: z.string(),
  /** Current structured refined body (updated after each round). */
  refinedBody: RequestSpecificationSchema.optional(),
  /** All Q&A rounds in chronological order. */
  rounds: z.array(ClarificationRoundSchema),
  /** Current lifecycle status of the session. */
  status: z.nativeEnum(ClarificationSessionStatus),
  /** Quality score progression tracked per round. */
  qualityHistory: z.array(QualityHistoryEntrySchema),
});

export type IClarificationSession = z.infer<typeof ClarificationSessionSchema>;
