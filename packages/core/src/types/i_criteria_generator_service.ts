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

/** Generates request-specific criteria from a request analysis, merged with static criteria at gate evaluation when `includeRequestCriteria` is enabled. */
export interface ICriteriaGeneratorService {
  /** Returns an empty array when the analysis has no extractable goals or acceptance criteria (never throws). */
  fromAnalysis(analysis: IRequestAnalysis): EvaluationCriterion[];
}
