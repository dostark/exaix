/**
 * @module CriteriaGenerator
 * @path src/services/skills/criteria_generator.ts
 * @description Converts structured RequestAnalysis output (goals and acceptance
 * criteria) into EvaluationCriterion arrays suitable for quality gate evaluation.
 * Implements ICriteriaGeneratorService for dependency injection.
 * @architectural-layer Services
 * @dependencies [evaluation_criteria, i_criteria_generator_service, request_analysis, constants]
 * @related-files [src/shared/interfaces/i_criteria_generator_service.ts, src/flows/evaluation_criteria.ts]
 */

import { EvaluationCriterion } from "../../flows/evaluation_criteria.ts";
import { EvaluationCategory } from "../../shared/enums.ts";
import { ICriteriaGeneratorService } from "../../shared/interfaces/i_criteria_generator_service.ts";
import { IRequestAnalysis } from "../../shared/schemas/request_analysis.ts";
import {
  ACCEPTANCE_CRITERION_WEIGHT,
  CRITERION_NAME_MAX_LENGTH,
  CRITERION_NAME_SANITIZE_PATTERN,
  DEFAULT_GOAL_WEIGHT,
  MAX_DYNAMIC_CRITERIA,
  PRIORITY_1_GOAL_WEIGHT,
} from "../../shared/constants.ts";

const PRIORITY_1 = 1;
const PRIORITY_REQUIRED_THRESHOLD = 2;

/**
 * Generates dynamic EvaluationCriterion arrays from RequestAnalysis data.
 * Only explicit goals are converted; inferred goals are ignored.
 */
export class CriteriaGenerator implements ICriteriaGeneratorService {
  /**
   * Converts RequestAnalysis goals and acceptance criteria into a sorted,
   * truncated list of EvaluationCriterion objects.
   *
   * Algorithm:
   * 1. Explicit goals → criterion named `goal_{sanitized}`, weighted by priority
   * 2. Acceptance criteria → criterion named `ac_{sanitized}`, weight 1.5, required
   * 3. Sort descending by weight; tiebreak ascending goal priority
   * 4. Truncate to MAX_DYNAMIC_CRITERIA
   */
  fromAnalysis(analysis: IRequestAnalysis): EvaluationCriterion[] {
    const goalCriteria = analysis.goals
      .filter((g) => g.explicit)
      .map((g) => ({
        criterion: {
          name: `goal_${this.sanitizeName(g.description)}`,
          description: g.description,
          weight: g.priority === PRIORITY_1 ? PRIORITY_1_GOAL_WEIGHT : DEFAULT_GOAL_WEIGHT,
          required: g.priority <= PRIORITY_REQUIRED_THRESHOLD,
          category: EvaluationCategory.COMPLETENESS,
        } satisfies EvaluationCriterion,
        priority: g.priority,
      }));

    const acCriteria = analysis.acceptanceCriteria.map((ac) => ({
      criterion: {
        name: `ac_${this.sanitizeName(ac)}`,
        description: ac,
        weight: ACCEPTANCE_CRITERION_WEIGHT,
        required: true,
        category: EvaluationCategory.COMPLETENESS,
      } satisfies EvaluationCriterion,
      priority: Number.MAX_SAFE_INTEGER,
    }));

    const combined = [...goalCriteria, ...acCriteria];

    combined.sort((a, b) => {
      if (b.criterion.weight !== a.criterion.weight) {
        return b.criterion.weight - a.criterion.weight;
      }
      return a.priority - b.priority;
    });

    return combined
      .slice(0, MAX_DYNAMIC_CRITERIA)
      .map((entry) => entry.criterion);
  }

  private sanitizeName(s: string): string {
    return s
      .toLowerCase()
      .replace(CRITERION_NAME_SANITIZE_PATTERN, "_")
      .slice(0, CRITERION_NAME_MAX_LENGTH);
  }
}
