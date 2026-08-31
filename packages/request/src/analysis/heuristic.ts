/**
 * @module HeuristicAnalyzer
 * @path packages/request/src/analysis/heuristic.ts
 * @description Zero-cost, zero-dependency heuristic text analysis strategy for
 * request intent extraction. Produces a `Partial<IRequestAnalysis>` by applying
 * regex patterns and keyword matching — no LLM calls, no network I/O.
 *
 * Detects: file references, action verb tags, complexity signals (char count,
 * bullet count, file count, phase keywords), ambiguity signals (hedging language,
 * question marks, vague pronoun phrases), and task type from leading verbs.
 * @architectural-layer Services
 * @related-files [packages/request/src/analysis/analyzer.ts]
 */

import {
  AmbiguityImpact,
  type IAmbiguity,
  RequestAnalysisComplexity,
  RequestTaskType,
} from "@exaix/schemas/request_analysis.ts";
import {
  ANALYSIS_COMPLEX_BULLET_THRESHOLD,
  ANALYSIS_COMPLEX_CHAR_THRESHOLD,
  ANALYSIS_COMPLEX_FILE_THRESHOLD,
  ANALYSIS_EPIC_KEYWORDS,
  ANALYSIS_FILE_REF_PATTERN,
  ANALYSIS_HEDGING_WORDS,
  ANALYSIS_SIMPLE_MAX_CHARS,
  ANALYSIS_TASK_TYPE_VERBS,
} from "@exaix/core";
import type { IRequestAnalysis } from "@exaix/core/request";
import type { IRequestAnalysisContext, Opt, Reason } from "@exaix/core/types";
// File reference extraction

function normalizeSchemaFileRef(path: string): string {
  if (path.startsWith("src/shared/schemas/")) {
    return path.replace(/^src\/shared\/schemas\//, "@exaix/schemas/");
  }
  if (path.startsWith("src/schemas/")) {
    return path.replace(/^src\/schemas\//, "@exaix/schemas/");
  }
  return path;
}

function extractFileRefs(text: string): string[] {
  const pattern = new RegExp(ANALYSIS_FILE_REF_PATTERN.source, ANALYSIS_FILE_REF_PATTERN.flags);
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    found.add(normalizeSchemaFileRef(match[1]));
  }
  return [...found];
}

// Complexity classification

function countBullets(text: string): number {
  return (text.match(/^[\s]*[-*+]\s+|^\s*\d+\.\s+/gm) ?? []).length;
}

function isEpic(text: string): boolean {
  const lower = text.toLowerCase();
  return ANALYSIS_EPIC_KEYWORDS.some((kw) => lower.includes(kw));
}

function classifyComplexity(
  text: string,
  fileCount: number,
  bulletCount: number,
): RequestAnalysisComplexity {
  if (isEpic(text)) return RequestAnalysisComplexity.EPIC;
  if (
    bulletCount > ANALYSIS_COMPLEX_BULLET_THRESHOLD ||
    fileCount > ANALYSIS_COMPLEX_FILE_THRESHOLD ||
    text.length > ANALYSIS_COMPLEX_CHAR_THRESHOLD
  ) {
    return RequestAnalysisComplexity.COMPLEX;
  }
  if (text.trim().length <= ANALYSIS_SIMPLE_MAX_CHARS && bulletCount <= 2 && fileCount <= 1) {
    return RequestAnalysisComplexity.SIMPLE;
  }
  return RequestAnalysisComplexity.MEDIUM;
}

// Ambiguity detection

function detectAmbiguities(text: string): IAmbiguity[] {
  const ambiguities: IAmbiguity[] = [];
  const lower = text.toLowerCase();

  // Hedging language
  const hedgingFound = ANALYSIS_HEDGING_WORDS.filter((w) => lower.includes(w));
  if (hedgingFound.length > 0) {
    ambiguities.push({
      description: `Hedging language detected: "${hedgingFound.slice(0, 3).join('", "')}"`,
      impact: AmbiguityImpact.MEDIUM,
      interpretations: [],
    });
  }

  // Unresolved questions
  const questionCount = (text.match(/\?/g) ?? []).length;
  if (questionCount > 0) {
    ambiguities.push({
      description: `Request contains ${questionCount} unresolved question(s)`,
      impact: questionCount > 2 ? AmbiguityImpact.HIGH : AmbiguityImpact.MEDIUM,
      interpretations: [],
    });
  }

  // Vague pronoun / demonstrative phrases
  const vaguePronouns = ["it should", "make that", "that thing", "the thing", "make it work"];
  const vagueFound = vaguePronouns.filter((p) => lower.includes(p));
  if (vagueFound.length > 0) {
    ambiguities.push({
      description: `Vague pronoun references: "${vagueFound.slice(0, 2).join('", "')}"`,
      impact: AmbiguityImpact.HIGH,
      interpretations: [],
    });
  }

  return ambiguities;
}

// Task type classification

function classifyTaskType(text: string): RequestTaskType {
  const lower = text.toLowerCase();
  // Sort by longer keys first so "add tests" wins over "add"
  const entries = Object.entries(ANALYSIS_TASK_TYPE_VERBS).sort(
    ([a], [b]) => b.length - a.length,
  );
  for (const [verb, type] of entries) {
    if (lower.includes(verb)) {
      switch (type) {
        case "bugfix":
          return RequestTaskType.BUGFIX;
        case "refactor":
          return RequestTaskType.REFACTOR;
        case RequestTaskType.TEST:
          return RequestTaskType.TEST;
        case "docs":
          return RequestTaskType.DOCS;
        case "analysis":
          return RequestTaskType.ANALYSIS;
        default:
          return RequestTaskType.FEATURE;
      }
    }
  }
  return RequestTaskType.UNKNOWN;
}

// Tag / keyword extraction

const ACTION_VERBS = [
  "implement",
  "add",
  "create",
  "build",
  "introduce",
  "fix",
  "bug",
  "repair",
  "resolve",
  "refactor",
  "restructure",
  "rewrite",
  "cleanup",
  "test",
  "document",
  "analyze",
  "analyse",
  "investigate",
  "integrate",
  "migrate",
  "update",
  "remove",
  "delete",
  "extend",
  "enhance",
  "improve",
  "optimise",
  "optimize",
  "commit",
];

function extractTags(text: string, fileRefs: string[]): string[] {
  const tags = new Set<string>();
  const lower = text.toLowerCase();

  for (const verb of ACTION_VERBS) {
    if (lower.includes(verb)) {
      tags.add(verb);
    }
  }

  // Add inferred domain tags from file refs
  for (const ref of fileRefs) {
    const parts = ref.split("/");
    if (parts.length >= 2) {
      const domain = parts[1]; // e.g. "services", "cli", "tui"
      if (domain && domain !== "shared") tags.add(domain);
    }
  }

  return [...tags];
}

// Public API

/** Zero-cost heuristic analysis. Returns a `Partial<IRequestAnalysis>` omitting fields that
 * require LLM output or defaults (`goals`, `requirements`, `acceptanceCriteria`,
 * `actionabilityScore`, `metadata`) — callers must merge or supply those. */
export function analyzeHeuristic(
  requestText: string,
  context?: Opt<Pick<IRequestAnalysisContext, "memories">, Reason.OptionalContext>,
): Partial<IRequestAnalysis> {
  if (!requestText || requestText.trim().length === 0) {
    return {
      referencedFiles: [],
      tags: [],
      ambiguities: [],
      constraints: [],
    };
  }

  const memoryText = context?.memories?.memoryContext ?? "";
  const combinedText = memoryText ? `${requestText}\n${memoryText}` : requestText;

  const fileRefs = extractFileRefs(combinedText);
  const bulletCount = countBullets(requestText);
  const complexity = classifyComplexity(requestText, fileRefs.length, bulletCount);
  const taskType = classifyTaskType(requestText);
  const ambiguities = detectAmbiguities(requestText);
  const tags = extractTags(requestText, fileRefs);

  return {
    complexity,
    taskType,
    referencedFiles: fileRefs,
    ambiguities,
    tags,
    constraints: [],
  };
}
