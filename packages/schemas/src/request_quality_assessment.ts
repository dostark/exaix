/**
 * @module RequestQualityAssessmentSchema
 * @path src/shared/schemas/request_quality_assessment.ts
 * @description Defines Zod validation schemas and inferred TypeScript types for
 * the request quality assessment output produced by the RequestQualityGate
 * service (Phase 47). Captures quality score, issue categories, enrichment
 * suggestions, and assessment metadata.
 * @architectural-layer Shared
 * * @related-files [src/shared/schemas/mod.ts, src/services/quality_gate/request_quality_gate.ts]
 */

import { z } from "zod";
import { QualityGateMode } from "@exaix/core";

// ============================================================================
// Enums
// ============================================================================

/**
 * Category of quality issue found in a request.
 */
export enum RequestQualityIssueType {
  VAGUE = "vague",
  AMBIGUOUS = "ambiguous",
  MISSING_CONTEXT = "missing_context",
  CONFLICTING = "conflicting",
  TOO_BROAD = "too_broad",
  NO_ACCEPTANCE_CRITERIA = "no_acceptance_criteria",
}

/**
 * Severity of a quality issue.
 */
export enum RequestQualityIssueSeverity {
  BLOCKER = "blocker",
  MAJOR = "major",
  MINOR = "minor",
}

/**
 * Overall quality level derived from the score.
 */
export enum RequestQualityLevel {
  EXCELLENT = "excellent",
  GOOD = "good",
  ACCEPTABLE = "acceptable",
  POOR = "poor",
  UNACTIONABLE = "unactionable",
}

/**
 * Recommended action based on quality assessment result.
 */
export enum RequestQualityRecommendation {
  PROCEED = "proceed",
  AUTO_ENRICH = "auto-enrich",
  NEEDS_CLARIFICATION = "needs-clarification",
  REJECT = "reject",
}

// QualityGateMode (heuristic/llm/hybrid) is defined in src/shared/enums.ts
// and used via z.nativeEnum(QualityGateMode) — no re-export needed here.

// ============================================================================
// Sub-schemas
// ============================================================================

/**
 * A single quality issue identified within a request.
 */
export const RequestQualityIssueSchema = z.object({
  /** Category of the issue. */
  type: z.nativeEnum(RequestQualityIssueType),
  /** Human-readable description of the specific problem. */
  description: z.string().min(1),
  /** How severely this issue impacts actionability. */
  severity: z.nativeEnum(RequestQualityIssueSeverity),
  /** Actionable suggestion for how to address this issue. */
  suggestion: z.string().min(1),
});

export type IRequestQualityIssue = z.infer<typeof RequestQualityIssueSchema>;

/**
 * Assessment metadata — timing and strategy information.
 */
export const RequestQualityAssessmentMetadataSchema = z.object({
  /** ISO 8601 timestamp when assessment was performed. */
  assessedAt: z.string(),
  /** Assessment strategy used to produce this result. */
  mode: z.nativeEnum(QualityGateMode),
  /** Wall-clock time to produce this assessment, in milliseconds. */
  durationMs: z.number().nonnegative(),
});

export type IRequestQualityAssessmentMetadata = z.infer<
  typeof RequestQualityAssessmentMetadataSchema
>;

// ============================================================================
// Root schema
// ============================================================================

/**
 * Full structured quality assessment of a request, produced by RequestQualityGate.
 */
export const RequestQualityAssessmentSchema = z.object({
  /**
   * Overall quality score (0–100).
   * 0 = completely vague/unactionable; 100 = fully specified, ready to execute.
   */
  score: z.number().int().min(0).max(100),
  /** Quality level derived from the score and configured thresholds. */
  level: z.nativeEnum(RequestQualityLevel),
  /** Specific quality issues found in the request. */
  issues: z.array(RequestQualityIssueSchema),
  /** Recommended action for the quality gate pipeline. */
  recommendation: z.nativeEnum(RequestQualityRecommendation),
  /**
   * If auto-enrich is recommended, the LLM-improved version of the request body.
   * Absent when auto-enrichment was not performed.
   */
  enrichedBody: z.string().optional(),
  /** Assessment timing and strategy metadata. */
  metadata: RequestQualityAssessmentMetadataSchema,
});

export type IRequestQualityAssessment = z.infer<typeof RequestQualityAssessmentSchema>;
