// deno-lint-ignore-file no-explicit-any
/**
 * @module HistoryWriterMetricAggregationTest
 * @path tests/scenario_framework/tests/unit/history_writer_metric_aggregation_test.ts
 * @description Phase 140a Step 4 — RED-first tests. writeEvalHistoryEntry must populate each
 * step_results entry's llm_duration_ms/tokens/tracked_cost_usd fields from the manifest (Step
 * 3's output), and compute scenario-level total_ prefixed aggregates as sums across
 * step_results. total_tracked_cost_usd must OMIT (not zero) any step with no defined
 * tracked_cost_usd.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/history_writer.ts, packages/eval-history/src/history_schema.ts]
 */

import { assertEquals } from "@std/assert";
import { writeEvalHistoryEntry } from "../../runner/history_writer.ts";
import type { IRunManifest } from "../../runner/evidence_collector.ts";

function makeManifest(steps: IRunManifest["steps"]): IRunManifest {
  return {
    scenarioId: "metric-aggregation-test",
    pack: "swe_tasks",
    mode: "auto",
    outcome: "success",
    suite_score: 1,
    steps,
  };
}

Deno.test({
  name:
    "[HistoryWriterMetricAggregation] step_results carries llm_duration_ms/tokens/trackedCostUsd from the manifest step",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "history-writer-metric-agg-" });
    try {
      const manifest = makeManifest([
        {
          stepId: "submit-request",
          stepType: "shell" as any,
          executionStatus: "passed",
          criterionResults: [],
          score: 1,
          llmDurationMs: 500,
          tokens: { prompt: 100, completion: 50, cacheRead: 20, cacheCreation: 10, total: 150 },
          trackedCostUsd: 0.05,
        },
      ]);

      const entry = await writeEvalHistoryEntry({ outputDir: dir, scenarioId: "metric-aggregation-test", manifest });

      assertEquals(entry.step_results?.[0].llm_duration_ms, 500);
      assertEquals(entry.step_results?.[0].tokens_prompt, 100);
      assertEquals(entry.step_results?.[0].tokens_completion, 50);
      assertEquals(entry.step_results?.[0].tokens_cache_read, 20);
      assertEquals(entry.step_results?.[0].tokens_cache_creation, 10);
      assertEquals(entry.step_results?.[0].tracked_cost_usd, 0.05);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[HistoryWriterMetricAggregation] scenario-level total_* aggregates equal the sum of per-step fields",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "history-writer-metric-agg-sum-" });
    try {
      const manifest = makeManifest([
        {
          stepId: "step-1",
          stepType: "shell" as any,
          executionStatus: "passed",
          criterionResults: [],
          score: 1,
          llmDurationMs: 200,
          tokens: { prompt: 10, completion: 5, cacheRead: 1, cacheCreation: 2, total: 15 },
          trackedCostUsd: 0.02,
        },
        {
          stepId: "step-2",
          stepType: "shell" as any,
          executionStatus: "passed",
          criterionResults: [],
          score: 1,
          llmDurationMs: 300,
          tokens: { prompt: 20, completion: 15, cacheRead: 3, cacheCreation: 4, total: 35 },
          trackedCostUsd: 0.03,
        },
      ]);

      const entry = await writeEvalHistoryEntry({ outputDir: dir, scenarioId: "metric-aggregation-test", manifest });

      assertEquals(entry.total_llm_duration_ms, 500);
      assertEquals(entry.total_tokens_prompt, 30);
      assertEquals(entry.total_tokens_completion, 20);
      assertEquals(entry.total_tokens_cache_read, 4);
      assertEquals(entry.total_tokens_cache_creation, 6);
      assertEquals(entry.total_tracked_cost_usd, 0.05);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "[HistoryWriterMetricAggregation] total_tracked_cost_usd omits steps with no tracked_cost_usd rather than treating them as zero",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "history-writer-metric-agg-untracked-" });
    try {
      const manifest = makeManifest([
        {
          stepId: "tracked-step",
          stepType: "shell" as any,
          executionStatus: "passed",
          criterionResults: [],
          score: 1,
          trackedCostUsd: 0.1,
        },
        {
          stepId: "predicted-only-step",
          stepType: "shell" as any,
          executionStatus: "passed",
          criterionResults: [],
          score: 1,
          // No trackedCostUsd at all — a pure direct-API step.
        },
      ]);

      const entry = await writeEvalHistoryEntry({ outputDir: dir, scenarioId: "metric-aggregation-test", manifest });

      assertEquals(entry.total_tracked_cost_usd, 0.1);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "[HistoryWriterMetricAggregation] no step has any tracked cost at all produces total_tracked_cost_usd: undefined",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "history-writer-metric-agg-none-tracked-" });
    try {
      const manifest = makeManifest([
        {
          stepId: "predicted-only-step",
          stepType: "shell" as any,
          executionStatus: "passed",
          criterionResults: [],
          score: 1,
        },
      ]);

      const entry = await writeEvalHistoryEntry({ outputDir: dir, scenarioId: "metric-aggregation-test", manifest });

      assertEquals(entry.total_tracked_cost_usd, undefined);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
