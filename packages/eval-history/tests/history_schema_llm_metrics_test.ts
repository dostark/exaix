/**
 * @module HistorySchemaLlmMetricsTest
 * @path packages/eval-history/tests/history_schema_llm_metrics_test.ts
 * @description Phase 140a Step 4 — RED-first tests. StepResultSchema and EvalHistoryEntrySchema
 * must accept the new per-step and scenario-level aggregate timing/token/tracked-cost fields,
 * all optional so every pre-Step-4 entry (with none of these fields) still validates.
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/history_schema.ts]
 */

import { assertEquals } from "@std/assert";
import { EvalHistoryEntrySchema, StepResultSchema } from "../src/history_schema.ts";

Deno.test("[HistorySchemaLlmMetrics] StepResultSchema accepts llm_duration_ms/tokens_*/tracked_cost_usd", () => {
  const parsed = StepResultSchema.parse({
    step_id: "submit-request",
    score: 1,
    llm_duration_ms: 500,
    tokens_prompt: 100,
    tokens_completion: 50,
    tokens_cache_read: 20,
    tokens_cache_creation: 10,
    tracked_cost_usd: 0.05,
  });

  assertEquals(parsed.llm_duration_ms, 500);
  assertEquals(parsed.tokens_prompt, 100);
  assertEquals(parsed.tokens_completion, 50);
  assertEquals(parsed.tokens_cache_read, 20);
  assertEquals(parsed.tokens_cache_creation, 10);
  assertEquals(parsed.tracked_cost_usd, 0.05);
});

Deno.test("[HistorySchemaLlmMetrics] StepResultSchema omits new fields cleanly (pre-Step-4 entries still validate)", () => {
  const parsed = StepResultSchema.parse({ step_id: "step-1", score: 1 });

  assertEquals(parsed.llm_duration_ms, undefined);
  assertEquals(parsed.tokens_prompt, undefined);
  assertEquals(parsed.tracked_cost_usd, undefined);
});

Deno.test("[HistorySchemaLlmMetrics] EvalHistoryEntrySchema accepts scenario-level total_* aggregates", () => {
  const parsed = EvalHistoryEntrySchema.parse({
    run_id: "run-1",
    scenario_id: "scenario-1",
    outcome: "success",
    mode: "auto",
    passed: true,
    timestamp: new Date().toISOString(),
    total_llm_duration_ms: 1500,
    total_tokens_prompt: 300,
    total_tokens_completion: 150,
    total_tokens_cache_read: 60,
    total_tokens_cache_creation: 30,
    total_tracked_cost_usd: 0.15,
  });

  assertEquals(parsed.total_llm_duration_ms, 1500);
  assertEquals(parsed.total_tokens_prompt, 300);
  assertEquals(parsed.total_tokens_completion, 150);
  assertEquals(parsed.total_tokens_cache_read, 60);
  assertEquals(parsed.total_tokens_cache_creation, 30);
  assertEquals(parsed.total_tracked_cost_usd, 0.15);
});

Deno.test("[HistorySchemaLlmMetrics] EvalHistoryEntrySchema omits total_tracked_cost_usd cleanly when never set", () => {
  const parsed = EvalHistoryEntrySchema.parse({
    run_id: "run-1",
    scenario_id: "scenario-1",
    outcome: "success",
    mode: "auto",
    passed: true,
    timestamp: new Date().toISOString(),
  });

  assertEquals(parsed.total_tracked_cost_usd, undefined);
});
