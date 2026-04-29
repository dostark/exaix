/**
 * @module HeuristicAssessor
 * @path src/services/quality_gate/heuristic_assessor.ts
 * @description Zero-cost heuristic quality assessor for incoming request bodies.
 * Scores requests using text signals (length, action verbs, file references,
 * acceptance criteria keywords, structure) without any LLM or network calls.
 * Suitable for use in sandboxed mode.
 * @architectural-layer Services
 * @related-files [src/services/quality_gate/request_quality_gate.ts, src/shared/constants.ts]
 */

import {
  type IRequestQualityAssessment,
  type IRequestQualityIssue,
  RequestQualityIssueSeverity,
  RequestQualityIssueType,
  RequestQualityLevel,
  RequestQualityRecommendation,
} from "@exaix/schemas/request_quality_assessment.ts";
import { QualityGateMode } from "@exaix/core";
import { AmbiguityImpact, type IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import {
  DEFAULT_QG_ENRICHMENT_THRESHOLD,
  DEFAULT_QG_MINIMUM_THRESHOLD,
  DEFAULT_QG_PROCEED_THRESHOLD,
  QG_ACCEPTANCE_CRITERIA_BONUS,
  QG_ACCEPTANCE_CRITERIA_KEYWORDS,
  QG_ACTION_VERBS,
  QG_CONTEXT_SECTION_BONUS,
  QG_FILE_REF_PATTERNS,
  QG_FILE_REFERENCE_BONUS,
  QG_HEURISTIC_SCORE_BASELINE,
  QG_NO_ACTION_VERBS_PENALTY,
  QG_NO_SPECIFIC_NOUNS_PENALTY,
  QG_QUESTIONS_ONLY_PENALTY,
  QG_SHORT_BODY_MAX_CHARS,
  QG_SHORT_BODY_PENALTY,
  QG_STRUCTURED_REQUIREMENTS_BONUS,
  QG_TECH_SPECIFICS_PATTERN,
  QG_TECHNICAL_SPECIFICS_BONUS,
} from "@exaix/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapScoreToLevel(score: number): RequestQualityLevel {
  if (score >= 85) return RequestQualityLevel.EXCELLENT;
  if (score >= DEFAULT_QG_PROCEED_THRESHOLD) return RequestQualityLevel.GOOD;
  if (score >= DEFAULT_QG_ENRICHMENT_THRESHOLD) return RequestQualityLevel.ACCEPTABLE;
  if (score >= DEFAULT_QG_MINIMUM_THRESHOLD) return RequestQualityLevel.POOR;
  return RequestQualityLevel.UNACTIONABLE;
}

function mapScoreToRecommendation(score: number): RequestQualityRecommendation {
  if (score >= DEFAULT_QG_PROCEED_THRESHOLD) return RequestQualityRecommendation.PROCEED;
  if (score >= DEFAULT_QG_ENRICHMENT_THRESHOLD) return RequestQualityRecommendation.AUTO_ENRICH;
  if (score >= DEFAULT_QG_MINIMUM_THRESHOLD) return RequestQualityRecommendation.NEEDS_CLARIFICATION;
  return RequestQualityRecommendation.REJECT;
}

function hasActionVerbsInText(text: string): boolean {
  const lower = text.toLowerCase();
  return QG_ACTION_VERBS.some((verb) => lower.includes(verb));
}

function hasOnlyQuestions(text: string): boolean {
  const sentences = text
    .split(/[.!]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return false;
  const questionSentences = sentences.filter((s) => s.endsWith("?") || s.includes("?"));
  return questionSentences.length === sentences.length;
}

function hasFileReferences(text: string): boolean {
  return QG_FILE_REF_PATTERNS.some((pattern) => pattern.test(text));
}

function hasAcceptanceCriteriaKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return QG_ACCEPTANCE_CRITERIA_KEYWORDS.some((kw) => lower.includes(kw));
}

function hasStructuredRequirements(text: string): boolean {
  // Detect numbered lists or bullet point lists with multiple items
  const bulletMatches = text.match(/^[\s]*[-*•]\s+.+$/gm);
  const numberedMatches = text.match(/^[\s]*\d+[.)]\s+.+$/gm);
  const bullets = bulletMatches?.length ?? 0;
  const numbered = numberedMatches?.length ?? 0;
  return bullets >= 2 || numbered >= 2;
}

function hasTechnicalSpecifics(text: string): boolean {
  return QG_TECH_SPECIFICS_PATTERN.test(text);
}

function hasContextSection(text: string): boolean {
  // Detect markdown headers or labeled context sections
  return /^#+\s+(?:context|background|overview|description)/im.test(text) ||
    /^(?:context|background)\s*:/im.test(text);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Map Phase-45 AmbiguityImpact to RequestQualityIssueSeverity.
 * HIGH → BLOCKER, MEDIUM → MAJOR, LOW → MINOR.
 */
function ambiguityImpactToSeverity(impact: AmbiguityImpact): RequestQualityIssueSeverity {
  switch (impact) {
    case AmbiguityImpact.HIGH:
      return RequestQualityIssueSeverity.BLOCKER;
    case AmbiguityImpact.MEDIUM:
      return RequestQualityIssueSeverity.MAJOR;
    default:
      return RequestQualityIssueSeverity.MINOR;
  }
}

// ---------------------------------------------------------------------------
// Main assessment function
// ---------------------------------------------------------------------------

/**
 * Run the full 9-signal heuristic scan on `trimmed` text.
 * Returns a raw score adjustment and a list of quality issues.
 * Internal helper — complexity is extracted here to keep `assessHeuristic` lean.
 */
function runFullHeuristicScan(
  trimmed: string,
): { score: number; issues: IRequestQualityIssue[] } {
  const issues: IRequestQualityIssue[] = [];
  let score = QG_HEURISTIC_SCORE_BASELINE;

  if (trimmed.length < QG_SHORT_BODY_MAX_CHARS) {
    score -= QG_SHORT_BODY_PENALTY;
    issues.push({
      type: RequestQualityIssueType.VAGUE,
      description: `Request body is too short (${trimmed.length} characters)`,
      severity: RequestQualityIssueSeverity.MAJOR,
      suggestion: "Provide a more detailed description with specific requirements",
    });
  }

  if (!hasActionVerbsInText(trimmed)) {
    score -= QG_NO_ACTION_VERBS_PENALTY;
    issues.push({
      type: RequestQualityIssueType.MISSING_CONTEXT,
      description: "Request does not contain action verbs indicating what to do",
      severity: RequestQualityIssueSeverity.MAJOR,
      suggestion: "Use action verbs like 'implement', 'fix', 'add', 'create', 'update' to specify what should be done",
    });
  }

  if (hasOnlyQuestions(trimmed)) {
    score -= QG_QUESTIONS_ONLY_PENALTY;
    issues.push({
      type: RequestQualityIssueType.AMBIGUOUS,
      description: "Request contains only questions with no directives",
      severity: RequestQualityIssueSeverity.MAJOR,
      suggestion: "Rephrase as instructions rather than questions",
    });
  }

  if (!hasFileReferences(trimmed) && !hasTechnicalSpecifics(trimmed)) {
    score -= QG_NO_SPECIFIC_NOUNS_PENALTY;
    issues.push({
      type: RequestQualityIssueType.MISSING_CONTEXT,
      description: "Request lacks specific file names, component names, or technical terms",
      severity: RequestQualityIssueSeverity.MINOR,
      suggestion: "Reference specific files, components, APIs, or technologies involved",
    });
  }

  if (hasFileReferences(trimmed)) score += QG_FILE_REFERENCE_BONUS;
  if (hasAcceptanceCriteriaKeywords(trimmed)) score += QG_ACCEPTANCE_CRITERIA_BONUS;
  if (hasStructuredRequirements(trimmed)) score += QG_STRUCTURED_REQUIREMENTS_BONUS;
  if (hasTechnicalSpecifics(trimmed)) score += QG_TECHNICAL_SPECIFICS_BONUS;
  if (hasContextSection(trimmed)) score += QG_CONTEXT_SECTION_BONUS;

  return { score, issues };
}

/**
 * Assess the quality of a request body using heuristic text signals.
 * Zero LLM / network dependencies — safe for sandboxed use.
 *
 * When `existingAnalysis` is provided (Phase-45 result), its `actionabilityScore`
 * is used as the base score and its `ambiguities` array is mapped to quality
 * issues. Supplementary signals not covered by Phase 45 (file references,
 * structured requirements, context section) are still applied on top.
 *
 * @param requestText - Raw Markdown body of the request.
 * @param existingAnalysis - Optional Phase-45 analysis to integrate. When absent,
 *   the full 9-signal heuristic scan is performed (backward-compatible).
 * @returns A complete `IRequestQualityAssessment` with score, level, issues, recommendation, and metadata.
 */
export function assessHeuristic(
  requestText: string,
  existingAnalysis?: IRequestAnalysis,
): IRequestQualityAssessment {
  const startMs = performance.now();

  const trimmed = requestText.trim();

  // Handle empty body
  if (trimmed.length === 0) {
    return {
      score: 0,
      level: RequestQualityLevel.UNACTIONABLE,
      issues: [
        {
          type: RequestQualityIssueType.VAGUE,
          description: "Request body is empty",
          severity: RequestQualityIssueSeverity.BLOCKER,
          suggestion: "Provide a description of what you want to achieve",
        },
      ],
      recommendation: RequestQualityRecommendation.REJECT,
      metadata: {
        assessedAt: new Date().toISOString(),
        mode: QualityGateMode.HEURISTIC,
        durationMs: Math.round(performance.now() - startMs),
      },
    };
  }

  let score: number;
  let issues: IRequestQualityIssue[];

  if (existingAnalysis !== undefined) {
    // Phase-45 integration path: use pre-computed actionabilityScore as base
    // and map its ambiguities to quality issues.
    score = existingAnalysis.actionabilityScore;
    issues = existingAnalysis.ambiguities.map((ambiguity) => ({
      type: RequestQualityIssueType.AMBIGUOUS,
      description: ambiguity.description,
      severity: ambiguityImpactToSeverity(ambiguity.impact),
      suggestion: ambiguity.clarificationQuestion ?? "Clarify this ambiguity before proceeding",
    }));

    // Supplementary signals that Phase 45 does not cover:
    if (hasFileReferences(trimmed)) score += QG_FILE_REFERENCE_BONUS;
    if (hasStructuredRequirements(trimmed)) score += QG_STRUCTURED_REQUIREMENTS_BONUS;
    if (hasContextSection(trimmed)) score += QG_CONTEXT_SECTION_BONUS;
  } else {
    // Full 9-signal heuristic scan (backward-compatible path).
    ({ score, issues } = runFullHeuristicScan(trimmed));
  }

  const finalScore = clamp(Math.round(score), 0, 100);

  return {
    score: finalScore,
    level: mapScoreToLevel(finalScore),
    issues,
    recommendation: mapScoreToRecommendation(finalScore),
    metadata: {
      assessedAt: new Date().toISOString(),
      mode: QualityGateMode.HEURISTIC,
      durationMs: Math.round(performance.now() - startMs),
    },
  };
}
