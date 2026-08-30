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
import { BINARY_VERSION, EvalScoringMode, WORKSPACE_SCHEMA_VERSION } from "@exaix/core";

/** Component versions stamped onto each eval-history entry for provenance. */
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
  /** Runner-observed wall-clock duration for this step, ms. */
  duration_ms: z.number().int().min(0).optional(),
  /** LLM-call wall-clock duration summed from journal payloads, ms. */
  llm_duration_ms: z.number().int().min(0).optional(),
  tokens_prompt: z.number().int().min(0).optional(),
  tokens_completion: z.number().int().min(0).optional(),
  tokens_cache_read: z.number().int().min(0).optional(),
  tokens_cache_creation: z.number().int().min(0).optional(),
  /** Real tracked cost only — never a calculateCost() prediction. */
  tracked_cost_usd: z.number().min(0).optional(),
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
  duration_ms: z.number().int().min(0).optional(),
  trace_id: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  cell_id: z.string().optional(),
  /** Scenario-level aggregates, summed across step_results. */
  total_llm_duration_ms: z.number().int().min(0).optional(),
  total_tokens_prompt: z.number().int().min(0).optional(),
  total_tokens_completion: z.number().int().min(0).optional(),
  total_tokens_cache_read: z.number().int().min(0).optional(),
  total_tokens_cache_creation: z.number().int().min(0).optional(),
  /** Sum of only the steps with a defined tracked_cost_usd — never a predicted figure. */
  total_tracked_cost_usd: z.number().min(0).optional(),
  /** Task-family tags propagated from scenario manifest. */
  tags: z.array(z.string()).optional(),
  /** Failure taxonomy for the run: distinct unrecovered anomaly event types. */
  failure_classes: z.array(z.string()).optional(),
  /** External-benchmark provenance present only on external-benchmark runs. */
  benchmark: z.string().min(1).optional(),
  benchmark_version: z.string().min(1).optional(),
  /** Scoring composition mode; defaults to additive. */
  scoring_mode: z.nativeEnum(EvalScoringMode).default(EvalScoringMode.ADDITIVE),
  component_versions: z.object({
    binary_version: z.string(),
    schema_version: z.string(),
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
