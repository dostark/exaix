/**
 * @module IRequestAnalyzerService
 * @path src/shared/interfaces/i_request_analyzer_service.ts
 * @description Service interface and configuration type for the RequestAnalyzer,
 * which extracts structured intent, requirements, and constraints from raw
 * request text before agent execution.
 * @architectural-layer Shared
 * @related-files [src/services/request_analysis/request_analyzer.ts, src/shared/interfaces/mod.ts]
 */

import type { IRequestAnalysis } from "@exaix/schemas";

import type { AnalysisMode } from "@exaix/core/request";

import type { EnhancedRequest } from "@exaix/core/types";

/**
 * Configuration for the RequestAnalyzer service.
 * All fields are optional; sensible defaults are applied by the implementation.
 */
export interface IRequestAnalyzerConfig {
  /**
   * Analysis strategy to use.
   * - `AnalysisMode.HEURISTIC` — fast, zero-cost regex/keyword (default in CI/sandboxed mode)
   * - `AnalysisMode.LLM` — full LLM-powered structured analysis
   * - `AnalysisMode.HYBRID` — heuristic first; escalate to LLM only when
   *    actionability is below `actionabilityThreshold`
   */
  mode: AnalysisMode;

  /**
   * Actionability score (0–100) below which hybrid mode escalates to LLM.
   * Defaults to `DEFAULT_ACTIONABILITY_THRESHOLD` (60) when not specified.
   */
  actionabilityThreshold?: number;

  /**
   * When `true`, the heuristic strategy attempts to infer acceptance criteria
   * from imperative sentences in the request body.
   * Defaults to `true`.
   */
  inferAcceptanceCriteria?: boolean;
}

/**
 * Optional context enrichment to provide alongside the raw request text.
 * All fields are optional; any supplied value is injected into the analysis
 * prompt / heuristic context to improve result quality.
 */
export interface IRequestAnalysisContext {
  /** The agent or flow ID that will execute the request, if known. */
  identityId?: string;
  /** Request priority (low/medium/high) as a string hint. */
  priority?: string;
  /** Known file paths already associated with the request (e.g. from frontmatter). */
  filePaths?: string[];
  /** Tags already extracted from frontmatter. */
  tags?: string[];
  /** Absolute path to the originating request file, used for activity journal targeting. */
  requestFilePath?: string;
  /** Trace ID carried from the request frontmatter, for correlated logging. */
  traceId?: string;
  /** Analysis mode override for this specific context (overrides config). */
  mode?: AnalysisMode;
  /** Memory context from session memory service, used to enrich analysis. */
  memories?: EnhancedRequest;
}

/**
 * Service interface for structured request intent analysis.
 *
 * Implementations MUST:
 * - Return a valid `IRequestAnalysis` (or a partial/fallback) even on failure
 * - Never throw; errors should be absorbed and reflected in a degraded `IRequestAnalysis`
 * - Populate `metadata.analyzedAt`, `metadata.durationMs`, and `metadata.mode`
 */
export interface IRequestAnalyzerService {
  /**
   * Produce a full `IRequestAnalysis` from raw request text.
   *
   * @param requestText - The raw Markdown body of the request (after frontmatter stripping).
   * @param context     - Optional enrichment context (agent ID, priority, known paths).
   * @returns A fully populated `IRequestAnalysis`.
   */
  analyze(
    requestText: string,
    context?: IRequestAnalysisContext,
  ): Promise<IRequestAnalysis>;

  /**
   * Fast synchronous-ish analysis returning only the fields that can be
   * cheaply computed (complexity, task type, referenced files, tags).
   * Does NOT call an LLM regardless of configured mode.
   *
   * Useful for urgent pipeline decisions (e.g., routing) where a full async
   * analysis would add latency.
   *
   * @param requestText - The raw Markdown body of the request.
   * @returns A partial analysis; fields not cheaply computable will be absent.
   */
  analyzeQuick(requestText: string): Partial<IRequestAnalysis>;
}
