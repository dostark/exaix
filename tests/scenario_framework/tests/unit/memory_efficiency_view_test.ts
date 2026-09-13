/**
 * @module MemoryEfficiencyViewTest
 * @path tests/scenario_framework/tests/unit/memory_efficiency_view_test.ts
 * @description RED-first tests for Phase 148 Step 5's `computeTokensPerQuery`/
 * `computeMsPerQuery` — report-time derived values (`tokens_total / query_count`,
 * `duration_ms / query_count`) over the EXISTING `IStepResult` fields
 * (`tokens_prompt`/`tokens_completion`/`duration_ms`), not new persisted fields.
 * Absent input tolerated — returns undefined (the report renders "—"), never throws.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/memory_efficiency.ts, packages/eval-history/src/history_schema.ts]
 */

import { assertEquals } from "@std/assert";
import { computeMsPerQuery, computeTokensPerQuery } from "../../runner/memory_efficiency.ts";

Deno.test("[TokensPerQuery] exact division across queries", () => {
  assertEquals(computeTokensPerQuery(100, 4), 25);
});

Deno.test("[TokensPerQuery] a single query is the whole token count", () => {
  assertEquals(computeTokensPerQuery(42, 1), 42);
});

Deno.test("[TokensPerQuery] undefined tokens (no LLM call happened) is tolerated, not an error", () => {
  assertEquals(computeTokensPerQuery(undefined, 3), undefined);
});

Deno.test("[TokensPerQuery] zero query count is tolerated — undefined, not a divide-by-zero error", () => {
  assertEquals(computeTokensPerQuery(100, 0), undefined);
});

Deno.test("[MsPerQuery] exact division across queries", () => {
  assertEquals(computeMsPerQuery(1000, 4), 250);
});

Deno.test("[MsPerQuery] undefined duration is tolerated, not an error", () => {
  assertEquals(computeMsPerQuery(undefined, 3), undefined);
});

Deno.test("[MsPerQuery] zero query count is tolerated — undefined, not a divide-by-zero error", () => {
  assertEquals(computeMsPerQuery(650, 0), undefined);
});
