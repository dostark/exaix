/**
 * @module CriteriaGenerator
 * @path packages/core/src/skills/criteria_generator.ts
 * @description Converts structured RequestAnalysis output (goals and acceptance
 * criteria) into EvaluationCriterion arrays suitable for quality gate evaluation.
 * Implements ICriteriaGeneratorService for dependency injection.
 */

import type { EvaluationCriterion } from "../types/mod.ts";
import { EvaluationCategory } from "../../mod.ts";
import type { ICriteriaGeneratorService } from "../types/mod.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import {
  ACCEPTANCE_CRITERION_WEIGHT,
  CRITERION_NAME_MAX_LENGTH,
  CRITERION_NAME_SANITIZE_PATTERN,
  DEFAULT_GOAL_WEIGHT,
  MAX_DYNAMIC_CRITERIA,
  PRIORITY_1_GOAL_WEIGHT,
} from "../../mod.ts";

const PRIORITY_1 = 1;
const PRIORITY_REQUIRED_THRESHOLD = 2;

export class CriteriaGenerator implements ICriteriaGeneratorService {
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
