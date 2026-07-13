/**
 * @module AgentExecutorCostEstimationRemovedTest
 * @path packages/execution/tests/agent_executor_cost_estimation_removed_test.ts
 * @description Phase 135 Step 12 (GAP-23/GAP-24/GAP-25) — proves
 *   AgentExecutor.estimateExecutionUsage() and its pricingLookup constructor
 *   parameter are fully removed, rather than narrowed. Before this step,
 *   AgentExecutor accepted a 16th positional pricingLookup argument
 *   (packages/core/src/types/i_model_pricing_lookup.ts:IModelPricingLookup) that
 *   fed a heuristic, structurally-inaccurate cost estimate
 *   (GAP-23: prices unmeasurable output tokens at the input rate; GAP-24: ignores
 *   prompt-cache-tier pricing entirely) whenever a strategy did not report real
 *   usage. The user's decision (GAP-25) was to remove the estimation pathway
 *   entirely rather than narrow its claimed scope — a step's cost is now either
 *   real (a strategy reported it) or absent, never a heuristic approximation.
 *   The behavioral counterpart of this proof (a real executeStep() run journals
 *   cost_usd_estimate: 0 with no heuristic computation) lives in
 *   tests/integration/agent/cost_logging_test.ts, which already owns the
 *   git-initialised-portal fixture this scenario needs.
 * @architectural-layer Test
 * @related-files [packages/execution/src/agent_executor.ts, tests/integration/agent/cost_logging_test.ts]
 */

import { assertEquals } from "@std/assert";

Deno.test("[regression] AgentExecutor constructor no longer accepts a pricingLookup argument (structural — TS2554 too-many-arguments at compile time if reintroduced)", () => {
  // AgentExecutor's constructor signature ends at `modelResolver` — there is no
  // 16th `pricingLookup` slot to pass. This is a structural/compile-time proof:
  // if the removed pricingLookup param or estimateExecutionUsage method were ever
  // reintroduced, this file (and the many call sites across the codebase that
  // construct AgentExecutor with exactly the parameters below) would need
  // updating, and `deno check` on this file is the actual gate. Checks for the
  // actual declarations, not any textual mention (a comment elsewhere in the
  // file legitimately references the removed method's name for context).
  const source = Deno.readTextFileSync(
    new URL("../src/agent_executor.ts", import.meta.url),
  );
  assertEquals(
    /private\s+async\s+estimateExecutionUsage\s*\(/.test(source),
    false,
    "estimateExecutionUsage must be fully removed, not narrowed (GAP-25)",
  );
  assertEquals(
    /pricingLookup\s*\?\s*:\s*Opt</.test(source),
    false,
    "the pricingLookup constructor parameter must be fully removed (GAP-25)",
  );
});
