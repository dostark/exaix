/**
 * @module EvaluationCriteriaTypes
 * @path packages/core/src/types/evaluation_criteria.ts
 * @description Shared evaluation criterion type definitions for @exaix/core.
 */

import { z } from "zod";
import { EvaluationCategory, type EvaluationCriterionProperty as _EvaluationCriterionProperty } from "@exaix/core";

export const EvaluationCriterionSchema = z.object({
  name: z.string(),
  description: z.string(),
  weight: z.number().min(0).max(10).default(1.0),
  required: z.boolean().default(false),
  category: z.nativeEnum(EvaluationCategory),
});

export type EvaluationCriterion = z.infer<typeof EvaluationCriterionSchema>;

export const CriterionResultSchema = z.object({
  name: z.string(),
  score: z.number().min(0).max(1),
  reasoning: z.string(),
  issues: z.array(z.string()).default([]),
  passed: z.boolean(),
});

export type CriterionResult = z.infer<typeof CriterionResultSchema>;

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
