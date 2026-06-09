/**
 * @module ScenarioFrameworkHistorySchema
 * @path tests/scenario_framework/schema/history_schema.ts
 * @description Defines the Zod schema for eval history JSONL entries
 * used by the scenario framework eval mode.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/history_writer.ts, tests/scenario_framework/tests/unit/history_writer_test.ts]
 */

import { z } from "zod";
import { BINARY_VERSION, WORKSPACE_SCHEMA_VERSION } from "@exaix/core";

export const StepResultSchema = z.object({
  step_id: z.string().min(1),
  score: z.number().min(0).max(1),
  criteria_passed: z.number().int().min(0).optional(),
  criteria_total: z.number().int().min(0).optional(),
});

export type IStepResult = z.infer<typeof StepResultSchema>;

export const EvalHistoryEntrySchema = z.object({
  run_id: z.string().min(1),
  scenario_id: z.string().min(1),
  pack: z.string().optional(),
  outcome: z.string().min(1),
  mode: z.string().min(1),
  suite_score: z.number().min(0).max(1).optional(),
  score_threshold: z.number().min(0).max(1).optional(),
  step_count: z.number().int().min(0).optional(),
  step_results: z.array(StepResultSchema).optional(),
  passed: z.boolean(),
  timestamp: z.string().datetime(),
  trials: z.number().int().min(1).optional(),
  suite_score_mean: z.number().min(0).max(1).optional(),
  suite_score_stdev: z.number().min(0).optional(),
  pass_at_1: z.number().min(0).max(1).optional(),
  pass_k: z.number().int().min(0).optional(),
  trial_scores: z.array(z.number().min(0).max(1)).optional(),
  blueprint_id: z.string().min(1).optional(),
  blueprint_version: z.string().min(1).optional(),
  component_versions: z.object({
    binary_version: z.string(),
    schema_version: z.string(),
  }).optional(),
});

export type IEvalHistoryEntry = z.infer<typeof EvalHistoryEntrySchema>;

export function getDefaultComponentVersions(): { binary_version: string; schema_version: string } {
  return {
    binary_version: BINARY_VERSION,
    schema_version: WORKSPACE_SCHEMA_VERSION,
  };
}
