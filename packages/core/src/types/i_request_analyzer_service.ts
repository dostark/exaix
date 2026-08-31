/**
 * @module IRequestAnalyzerService
 * @path packages/core/src/types/i_request_analyzer_service.ts
 * @description Service interface and configuration type for the RequestAnalyzer,
 * which extracts structured intent, requirements, and constraints from raw
 * request text before agent execution.
 * @architectural-layer Shared
 * @related-files [packages/request/src/analysis/analyzer.ts, packages/core/src/types/mod.ts]
 */

import type { IRequestAnalysis } from "@exaix/schemas";

import type { AnalysisMode } from "@exaix/core/request";

import type { EnhancedRequest } from "@exaix/core/types";

/** Configuration for the RequestAnalyzer service; all fields are optional with implementation defaults. */
export interface IRequestAnalyzerConfig {
  /** `HEURISTIC` (fast, zero-cost, default in CI/sandboxed mode), `LLM` (full LLM-powered),
   *  or `HYBRID` (heuristic first, escalates to LLM below `actionabilityThreshold`). */
  mode: AnalysisMode;

  /** Actionability score (0–100) below which hybrid mode escalates to LLM; defaults to
   *  `DEFAULT_ACTIONABILITY_THRESHOLD` (60). */
  actionabilityThreshold?: number;

  /** When `true` (the default), the heuristic strategy infers acceptance criteria from
   *  imperative sentences in the request body. */
  inferAcceptanceCriteria?: boolean;
}

/** Optional context enrichment injected into the analysis prompt/heuristic context to improve result quality. */
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

/** Service interface for structured request intent analysis. Implementations must never throw
 *  (absorb errors into a degraded result) and must populate metadata.analyzedAt/durationMs/mode. */
export interface IRequestAnalyzerService {
  analyze(
    requestText: string,
    context?: IRequestAnalysisContext,
  ): Promise<IRequestAnalysis>;

  /** Fast synchronous-ish analysis of only cheaply-computed fields (complexity, task type,
   *  referenced files, tags); does NOT call an LLM regardless of configured mode. Useful for
   *  urgent pipeline decisions (e.g. routing) where a full async analysis would add latency. */
  analyzeQuick(requestText: string): Partial<IRequestAnalysis>;
}
