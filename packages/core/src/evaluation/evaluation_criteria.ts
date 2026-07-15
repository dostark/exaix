/**
 * @module EvaluationCriteria
 * @path packages/core/src/evaluation/evaluation_criteria.ts
 * @related-files []
 * @description defines built-in and custom criteria for LLM-as-a-Judge evaluations, supporting weighted scoring and quality gates.
 * @architectural-layer Core
 */

import { z } from "zod";
import { EvaluationCategory, type EvaluationCriterionProperty, FulfillmentStatus } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

export const EvaluationCriterionSchema = z.object({
  name: z.string(),
  description: z.string(),
  weight: z.number().min(0).max(10).default(1.0),
  required: z.boolean().default(false),
  category: z.nativeEnum(EvaluationCategory),
});

export type EvaluationCriterion = z.infer<typeof EvaluationCriterionSchema>;

export const CriterionResultSchema = z.object({
  name: z.string().optional(),
  score: z.number().min(0).max(1),
  reasoning: z.string(),
  issues: z.array(z.string()).default([]),
  passed: z.boolean(),
});

export type CriterionResult = z.infer<typeof CriterionResultSchema>;

export const RequirementFulfillmentSchema = z.object({
  requirement: z.string(),
  status: z.nativeEnum(FulfillmentStatus),
});

export type IRequirementFulfillment = z.infer<typeof RequirementFulfillmentSchema>;

export const EvaluationResultSchema = z.object({
  overallScore: z.number().min(0).max(1),
  criteriaScores: z.record(CriterionResultSchema),
  pass: z.boolean(),
  feedback: z.string(),
  suggestions: z.array(z.string()).default([]),
  metadata: z.object({
    evaluatedAt: z.string(),
    evaluatorAgent: z.string().optional(),
    evaluationDurationMs: z.number().optional(),
  }).optional(),
});

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

export const CRITERIA = {
  CODE_CORRECTNESS: {
    name: "code_correctness",
    description:
      "Code is syntactically correct and would compile/run without errors. Check for syntax errors, type mismatches, and logical correctness.",
    weight: 2.0,
    required: true,
    category: EvaluationCategory.CORRECTNESS,
  },

  CODE_COMPLETENESS: {
    name: "code_completeness",
    description:
      "All requirements from the prompt are addressed. Implementation covers all requested functionality without missing features.",
    weight: 1.5,
    required: true,
    category: EvaluationCategory.COMPLETENESS,
  },

  HAS_TESTS: {
    name: "has_tests",
    description:
      "Implementation includes appropriate test coverage. Tests cover main functionality, edge cases, and error scenarios.",
    weight: 1.0,
    required: false,
    category: EvaluationCategory.QUALITY,
  },

  FOLLOWS_CONVENTIONS: {
    name: "follows_conventions",
    description:
      "Code follows project style and naming conventions. Consistent formatting, meaningful variable names, and idiomatic patterns.",
    weight: 0.8,
    required: false,
    category: EvaluationCategory.STYLE,
  },

  NO_SECURITY_ISSUES: {
    name: "no_security_issues",
    description:
      "No obvious security vulnerabilities. Checks for injection risks, exposed secrets, insecure patterns, and unsafe operations.",
    weight: 2.0,
    required: true,
    category: EvaluationCategory.SECURITY,
  },

  ERROR_HANDLING: {
    name: "error_handling",
    description:
      "Proper error handling is implemented. Errors are caught, logged appropriately, and meaningful messages are provided.",
    weight: 1.0,
    required: false,
    category: EvaluationCategory.QUALITY,
  },

  CLARITY: {
    name: "clarity",
    description:
      "Output is clear, well-organized, and understandable. Logical structure, good formatting, and easy to follow.",
    weight: 1.0,
    required: false,
    category: EvaluationCategory.QUALITY,
  },

  ACCURACY: {
    name: "accuracy",
    description: "Information provided is factually correct and accurate. No hallucinations or incorrect statements.",
    weight: 2.0,
    required: true,
    category: EvaluationCategory.CORRECTNESS,
  },

  RELEVANCE: {
    name: "relevance",
    description:
      "Response is relevant to the original request. Directly addresses the question without unnecessary tangents.",
    weight: 1.2,
    required: false,
    category: EvaluationCategory.COMPLETENESS,
  },

  CONCISENESS: {
    name: "conciseness",
    description:
      "Response is appropriately concise without unnecessary verbosity. Information is presented efficiently.",
    weight: 0.5,
    required: false,
    category: EvaluationCategory.STYLE,
  },

  DOCUMENTATION_QUALITY: {
    name: "documentation_quality",
    description:
      "Documentation is clear, comprehensive, and follows best practices. Includes examples where appropriate.",
    weight: 1.0,
    required: false,
    category: EvaluationCategory.QUALITY,
  },

  API_CONSISTENCY: {
    name: "api_consistency",
    description: "API design is consistent with existing patterns. Follows established conventions and naming schemes.",
    weight: 0.8,
    required: false,
    category: EvaluationCategory.STYLE,
  },

  PERFORMANCE_CONSIDERATIONS: {
    name: "performance_considerations",
    description:
      "Implementation considers performance implications. Avoids obvious inefficiencies and uses appropriate algorithms.",
    weight: 0.7,
    required: false,
    category: EvaluationCategory.PERFORMANCE,
  },

  SCALABILITY: {
    name: "scalability",
    description: "Solution can scale appropriately. Handles edge cases like empty inputs and large datasets.",
    weight: 0.5,
    required: false,
    category: EvaluationCategory.PERFORMANCE,
  },

  GOAL_ALIGNMENT: {
    name: "goal_alignment",
    description: "The response directly accomplishes the stated objective(s). " +
      "Every primary goal from the original request is addressed. " +
      "Check the response against each stated goal and verify it is met.",
    weight: 2.5,
    required: true,
    category: EvaluationCategory.COMPLETENESS,
  },

  TASK_FULFILLMENT: {
    name: "task_fulfillment",
    description: "All explicitly stated requirements are fulfilled. " +
      "Each functional requirement is implemented, each constraint is respected, " +
      "and no stated requirement is silently omitted.",
    weight: 2.0,
    required: true,
    category: EvaluationCategory.COMPLETENESS,
  },

  REQUEST_UNDERSTANDING: {
    name: "request_understanding",
    description: "The response demonstrates correct understanding of the task. " +
      "The approach taken is appropriate for the goal, terminology is used correctly, " +
      "and the response doesn't solve a different problem than what was asked.",
    weight: 1.5,
    required: false,
    category: EvaluationCategory.CORRECTNESS,
  },
} as const;

export const CRITERION_SETS = {
  CODE_REVIEW: [
    CRITERIA.CODE_CORRECTNESS,
    CRITERIA.CODE_COMPLETENESS,
    CRITERIA.FOLLOWS_CONVENTIONS,
    CRITERIA.ERROR_HANDLING,
    CRITERIA.NO_SECURITY_ISSUES,
  ],

  CODE_REVIEW_FULL: [
    CRITERIA.CODE_CORRECTNESS,
    CRITERIA.CODE_COMPLETENESS,
    CRITERIA.HAS_TESTS,
    CRITERIA.FOLLOWS_CONVENTIONS,
    CRITERIA.ERROR_HANDLING,
    CRITERIA.NO_SECURITY_ISSUES,
    CRITERIA.DOCUMENTATION_QUALITY,
    CRITERIA.PERFORMANCE_CONSIDERATIONS,
  ],

  SECURITY_REVIEW: [
    CRITERIA.NO_SECURITY_ISSUES,
    CRITERIA.ERROR_HANDLING,
    CRITERIA.CODE_CORRECTNESS,
  ],

  CONTENT_QUALITY: [
    CRITERIA.CLARITY,
    CRITERIA.ACCURACY,
    CRITERIA.RELEVANCE,
    CRITERIA.CONCISENESS,
    CRITERIA.DOCUMENTATION_QUALITY,
  ],

  MINIMAL_GATE: [
    CRITERIA.CODE_CORRECTNESS,
    CRITERIA.ACCURACY,
    CRITERIA.RELEVANCE,
  ],

  API_REVIEW: [
    CRITERIA.CODE_CORRECTNESS,
    CRITERIA.API_CONSISTENCY,
    CRITERIA.DOCUMENTATION_QUALITY,
    CRITERIA.ERROR_HANDLING,
  ],

  GOAL_ALIGNED_REVIEW: [
    CRITERIA.GOAL_ALIGNMENT,
    CRITERIA.TASK_FULFILLMENT,
    CRITERIA.REQUEST_UNDERSTANDING,
    CRITERIA.CODE_CORRECTNESS,
    CRITERIA.CODE_COMPLETENESS,
  ],

  FULL_QUALITY_GATE: [
    CRITERIA.GOAL_ALIGNMENT,
    CRITERIA.TASK_FULFILLMENT,
    CRITERIA.CODE_CORRECTNESS,
    CRITERIA.CODE_COMPLETENESS,
    CRITERIA.NO_SECURITY_ISSUES,
    CRITERIA.HAS_TESTS,
    CRITERIA.ERROR_HANDLING,
  ],
};

export function getCriteriaByNames(names: string[]): EvaluationCriterion[] {
  const criteria: EvaluationCriterion[] = [];

  for (const name of names) {
    const upperName = name.toUpperCase().replace(/-/g, "_");
    const criterion = CRITERIA[upperName as keyof typeof CRITERIA];
    if (criterion) {
      criteria.push(criterion);
    } else {
      console.warn(`Unknown criterion: ${name}`);
    }
  }

  return criteria;
}

export function calculateWeightedScore(
  criteriaResults: Record<string, CriterionResult>,
  criteria: EvaluationCriterion[],
): number {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const criterion of criteria) {
    const result = criteriaResults[criterion.name];
    if (result) {
      weightedSum += result.score * criterion.weight;
      totalWeight += criterion.weight;
    }
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

export function checkRequiredCriteria(
  criteriaResults: Record<string, CriterionResult>,
  criteria: EvaluationCriterion[],
  threshold: number = 0.7,
): boolean {
  for (const criterion of criteria) {
    if (criterion.required) {
      const result = criteriaResults[criterion.name];
      if (!result || result.score < threshold) {
        return false;
      }
    }
  }
  return true;
}

export function createCriterion(
  name: string,
  description: string,
  options: Partial<
    Omit<EvaluationCriterion, EvaluationCriterionProperty.NAME | EvaluationCriterionProperty.DESCRIPTION>
  > = {},
): EvaluationCriterion {
  return EvaluationCriterionSchema.parse({
    name,
    description,
    category: EvaluationCategory.QUALITY,
    ...options,
  });
}

export function buildEvaluationPrompt(
  content: string,
  criteria: EvaluationCriterion[],
  context?: Opt<string, Reason.OptionalContext>,
): string {
  const criteriaList = criteria
    .map((c, i: number) =>
      `${i + 1}. **${c.name}** (weight: ${c.weight}${c.required ? ", REQUIRED" : ""})\n   ${c.description}`
    )
    .join("\n\n");

  return `## Evaluation Request

${context ? `### Context\n${context}\n\n` : ""}### Content to Evaluate

\`\`\`
${content}
\`\`\`

### Evaluation Criteria

${criteriaList}

### Instructions

Evaluate the content against each criterion above. For each criterion:
1. Assign a score from 0.0 to 1.0
2. Provide brief reasoning (1-2 sentences)
3. List specific issues found (if any)

Then provide an overall assessment.

### Required Output Format

Respond with valid JSON only — no markdown fences, no extra text:

{
  "name": "task_fulfillment",
  "score": 0.85,
  "reasoning": "Brief explanation of the score",
  "issues": ["issue 1", "issue 2"],
  "passed": true
}`;
}
