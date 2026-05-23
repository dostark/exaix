/**
 * @module ICriteriaGeneratorService
 * @path packages/core/src/types/i_criteria_generator_service.ts
 * @description Service interface for dynamically generating EvaluationCriterion
 * objects from a structured request analysis, enabling goal-aligned evaluation.
 * @architectural-layer Shared
 * @related-files [packages/core/src/skills/criteria_generator.ts, packages/core/src/types/mod.ts]
 */

import type { EvaluationCriterion } from "@exaix/core/types";

import type { IRequestAnalysis } from "@exaix/schemas";

/**
 * Generates request-specific EvaluationCriterion objects from a structured
 * request analysis. Criteria produced here are merged with static criteria at
 * gate evaluation time when `includeRequestCriteria` is enabled.
 *
 * Note: `fromSpecification()` is deferred to Phase 49 — IRequestSpecification
 * is not persisted in PlanFrontmatterSchema and is unavailable at evaluation time.
 */
export interface ICriteriaGeneratorService {
  /**
   * Derive evaluation criteria from the goals and acceptance criteria found in
   * the provided request analysis.
   *
   * @param analysis - Structured analysis output from IRequestAnalyzerService.
   * @returns Array of EvaluationCriterion objects; empty when no extractable
   *   goals or acceptance criteria are present.
   */
  fromAnalysis(analysis: IRequestAnalysis): EvaluationCriterion[];
}
