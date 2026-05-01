/**
 * @module RequestAnalyzer
 * @path src/services/request_analysis/request_analyzer.ts
 * @description Orchestrator service for request intent analysis. Implements
 * `IRequestAnalyzerService` and delegates to the heuristic strategy, the
 * `LlmAnalyzer`, or both (hybrid mode) based on the supplied configuration.
 *
 * Hybrid mode runs heuristic first; escalates to LLM only when the heuristic
 * actionability score falls below `actionabilityThreshold`. File references
 * detected by the heuristic are merged into LLM results to ensure they are
 * never lost. Activity is logged to the database journal when a `db` instance
 * is provided.
 * @architectural-layer Services
 * @related-files [src/services/request_analysis/mod.ts, "src/services/request/request_processor.ts"]
 */

import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IOutputValidator } from "../tool/output_validator.ts";
import type { IDatabaseService } from "@exaix/core/types/i_database_service.ts";
import type { IRequestAnalysisContext, IRequestAnalyzerConfig, IRequestAnalyzerService } from "@exaix/core/types";
import { type IRequestAnalysis, RequestAnalysisComplexity, RequestTaskType } from "@exaix/schemas/request_analysis.ts";
import { AnalysisMode } from "@exaix/core/types/mod.ts";
import { analyzeHeuristic } from "./heuristic_analyzer.ts";
import { LlmAnalyzer } from "./llm_analyzer.ts";
import {
  ANALYZER_VERSION,
  DEFAULT_ACTIONABILITY_THRESHOLD,
  HEURISTIC_SCORE_AMBIGUITY_PENALTY,
  HEURISTIC_SCORE_BASELINE,
  HEURISTIC_SCORE_COMPLEXITY_BONUS,
} from "@exaix/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive an actionability score from a partial heuristic result.
 * Uses ambiguity count and complexity as a proxy (no real score from heuristic).
 */
function heuristicActionabilityScore(partial: Partial<IRequestAnalysis>): number {
  let score = HEURISTIC_SCORE_BASELINE;
  const ambiguities = partial.ambiguities ?? [];
  score -= ambiguities.length * HEURISTIC_SCORE_AMBIGUITY_PENALTY;
  if (partial.complexity === RequestAnalysisComplexity.SIMPLE) score += HEURISTIC_SCORE_COMPLEXITY_BONUS;
  if (partial.complexity === RequestAnalysisComplexity.EPIC) score -= HEURISTIC_SCORE_COMPLEXITY_BONUS;
  return Math.max(0, Math.min(100, score));
}

/**
 * Merge heuristic file references into an LLM result, deduplicating by value.
 */
function mergeFileRefs(base: IRequestAnalysis, heuristic: Partial<IRequestAnalysis>): IRequestAnalysis {
  const heuristicFiles = heuristic.referencedFiles ?? [];
  if (heuristicFiles.length === 0) return base;
  const merged = [...new Set([...base.referencedFiles, ...heuristicFiles])];
  return { ...base, referencedFiles: merged };
}

/**
 * Build a complete `IRequestAnalysis` from a partial heuristic result.
 * Fills all required fields with safe defaults so the result is always valid.
 */
function completeFromHeuristic(
  partial: Partial<IRequestAnalysis>,
  requestText: string,
  durationMs: number,
  mode: AnalysisMode = AnalysisMode.HEURISTIC,
): IRequestAnalysis {
  let goals = partial.goals ?? [];

  // Fallback: Use the first non-empty line (skipping frontmatter) as the main goal
  if (goals.length === 0) {
    const lines = requestText.trim().split("\n");
    for (let line of lines) {
      line = line.trim();
      if (line && line !== "---" && !line.startsWith("#")) {
        goals = [{
          description: line,
          explicit: true,
          priority: 1,
        }];
        break;
      }
    }
  }

  return {
    goals: goals,
    requirements: partial.requirements ?? [],
    constraints: partial.constraints ?? [],
    acceptanceCriteria: partial.acceptanceCriteria ?? [],
    ambiguities: partial.ambiguities ?? [],
    actionabilityScore: heuristicActionabilityScore(partial),
    complexity: partial.complexity ??
      (requestText.trim().length <= 200 ? RequestAnalysisComplexity.SIMPLE : RequestAnalysisComplexity.MEDIUM),
    taskType: partial.taskType ?? RequestTaskType.UNKNOWN,
    tags: partial.tags ?? [],
    referencedFiles: partial.referencedFiles ?? [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs,
      mode: mode,
      analyzerVersion: ANALYZER_VERSION,
    },
  };
}

// ---------------------------------------------------------------------------
// RequestAnalyzer
// ---------------------------------------------------------------------------

/**
 * Orchestrates heuristic and LLM analysis strategies to produce structured
 * request intent analysis.
 */
export class RequestAnalyzer implements IRequestAnalyzerService {
  private readonly threshold: number;
  private readonly llmAnalyzer: LlmAnalyzer | null;

  constructor(
    private readonly config: IRequestAnalyzerConfig,
    private readonly provider?: IModelProvider,
    private readonly validator?: IOutputValidator,
    private readonly db?: Pick<IDatabaseService, "logActivity">,
  ) {
    this.threshold = config.actionabilityThreshold ?? DEFAULT_ACTIONABILITY_THRESHOLD;
    this.llmAnalyzer = provider && validator ? new LlmAnalyzer(provider, validator) : null;
  }

  async analyze(
    requestText: string,
    context?: IRequestAnalysisContext,
  ): Promise<IRequestAnalysis> {
    const startMs = Date.now();
    const mode = this.config.mode;

    let result: IRequestAnalysis;

    if (mode === AnalysisMode.HEURISTIC) {
      const partial = analyzeHeuristic(requestText, context);
      result = completeFromHeuristic(partial, requestText, Date.now() - startMs, AnalysisMode.HEURISTIC);
    } else if (mode === AnalysisMode.LLM) {
      result = await this._callLlmWithFallback(requestText, context, startMs);
      // Always merge heuristic file refs into LLM result
      const heuristicPartial = analyzeHeuristic(requestText, context);
      result = mergeFileRefs(result, heuristicPartial);
    } else {
      // hybrid
      const heuristicPartial = analyzeHeuristic(requestText, context);
      const hScore = heuristicActionabilityScore(heuristicPartial);

      if (hScore >= this.threshold || !this.llmAnalyzer) {
        result = completeFromHeuristic(heuristicPartial, requestText, Date.now() - startMs, AnalysisMode.HYBRID);
      } else {
        try {
          const llmResult = await this.llmAnalyzer.analyze(requestText, context);
          result = mergeFileRefs(llmResult, heuristicPartial);
        } catch {
          result = completeFromHeuristic(heuristicPartial, requestText, Date.now() - startMs, AnalysisMode.HYBRID);
        }
      }
    }

    // Stamp final timing
    result = {
      ...result,
      metadata: {
        ...result.metadata,
        durationMs: Date.now() - startMs,
      },
    };

    this._logActivity(requestText, result, context);
    return result;
  }

  /**
   * Fast synchronous-style analysis (no LLM, regardless of mode).
   */
  analyzeQuick(requestText: string): Partial<IRequestAnalysis> {
    if (!requestText || requestText.trim().length === 0) {
      return { referencedFiles: [], tags: [], ambiguities: [], constraints: [] };
    }
    return analyzeHeuristic(requestText);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async _callLlmWithFallback(
    requestText: string,
    context: IRequestAnalysisContext | undefined,
    startMs: number,
  ): Promise<IRequestAnalysis> {
    if (!this.llmAnalyzer) {
      const partial = analyzeHeuristic(requestText);
      return completeFromHeuristic(partial, requestText, Date.now() - startMs, AnalysisMode.LLM);
    }
    try {
      return await this.llmAnalyzer.analyze(requestText, context);
    } catch {
      const partial = analyzeHeuristic(requestText);
      return completeFromHeuristic(partial, requestText, Date.now() - startMs, AnalysisMode.LLM);
    }
  }

  private _logActivity(requestText: string, result: IRequestAnalysis, context?: IRequestAnalysisContext): void {
    if (!this.db) return;
    try {
      this.db.logActivity(
        "RequestAnalyzer",
        "request.analyzed",
        context?.requestFilePath ?? null,
        {
          mode: result.metadata.mode,
          complexity: result.complexity,
          taskType: result.taskType,
          actionabilityScore: result.actionabilityScore,
          durationMs: result.metadata.durationMs,
          requestLength: requestText.length,
        },
      );
    } catch {
      // Non-fatal — analysis result is already produced
    }
  }
}
