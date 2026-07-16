/**
 * @module EvalHistorySchema
 * @path packages/eval-history/src/history_schema.ts
 * @description Defines the Zod schema for eval history JSONL entries used by the
 * `exactl eval` command and the scenario-framework eval mode.
 * @architectural-layer Shared
 * @dependencies [zod, @exaix/core]
 * @related-files [packages/eval-history/src/history_sqlite.ts, packages/eval-history/mod.ts]
 */

import { z } from "zod";
import { BINARY_VERSION, WORKSPACE_SCHEMA_VERSION } from "@exaix/core";

/**
 * Component versions stamped onto each eval-history entry for provenance. `binary_version` +
 * `schema_version` pin the exactl binary and the declarative scenario contract; `framework_commit`
 * + `framework_dirty` pin the scenario-framework SOURCE revision that actually produced the run.
 */
export interface IComponentVersions {
  binary_version: string;
  schema_version: string;
  framework_commit?: string;
  framework_dirty?: boolean;
}

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
  pass_pow_k: z.number().min(0).max(1).optional(),
  pass_k: z.number().int().min(0).optional(),
  trial_scores: z.array(z.number().min(0).max(1)).optional(),
  blueprint_id: z.string().min(1).optional(),
  blueprint_version: z.string().min(1).optional(),
  component_versions: z.object({
    binary_version: z.string(),
    schema_version: z.string(),
    // Scenario-framework code provenance: the git revision of the framework that produced this run.
    // `schema_version` pins the declarative scenario contract; these pin the actual runner/executor
    // source, so a result is attributable to (and reproducible from) a specific framework version.
    // Both optional for backward compatibility with entries written before provenance was recorded.
    framework_commit: z.string().optional(),
    framework_dirty: z.boolean().optional(),
  }).optional(),
});

export type IEvalHistoryEntry = z.infer<typeof EvalHistoryEntrySchema>;

export function getDefaultComponentVersions(): IComponentVersions {
  return {
    binary_version: BINARY_VERSION,
    schema_version: WORKSPACE_SCHEMA_VERSION,
  };
}
