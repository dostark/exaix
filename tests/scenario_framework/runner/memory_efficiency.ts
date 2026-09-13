/**
 * @module MemoryEfficiency
 * @path tests/scenario_framework/runner/memory_efficiency.ts
 * @description Report-time derived cost/latency efficiency for the Phase 148 Memory
 * Evaluation Framework: tokens/ms per query, computed from the EXISTING per-step
 * `IStepResult` fields (`tokens_prompt`/`tokens_completion`/`duration_ms`,
 * `packages/eval-history/src/history_schema.ts`) — no new persisted field. Undefined
 * input (no LLM call happened, or zero queries) is tolerated, never thrown on; the
 * report renders "—" for an undefined result.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/memory_efficiency_view_test.ts, tests/scenario_framework/tests/unit/memory_cost_capture_test.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";

/** `totalTokens / queryCount`, or undefined if either input is missing/zero. */
export function computeTokensPerQuery(
  totalTokens: Opt<number, Reason.OptionalInput>,
  queryCount: number,
): number | undefined {
  if (totalTokens === undefined || queryCount === 0) return undefined;
  return totalTokens / queryCount;
}

/** `totalDurationMs / queryCount`, or undefined if either input is missing/zero. */
export function computeMsPerQuery(
  totalDurationMs: Opt<number, Reason.OptionalInput>,
  queryCount: number,
): number | undefined {
  if (totalDurationMs === undefined || queryCount === 0) return undefined;
  return totalDurationMs / queryCount;
}
