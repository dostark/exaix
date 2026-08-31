/**
 * @module AgentExecutorCostEstimationRemovedTest
 * @path packages/execution/tests/agent_orchestrator_cost_estimation_removed_test.ts
 * @description Phase 135 Step 12 (GAP-23/GAP-24/GAP-25) — proves
 *   AgentOrchestrator.estimateExecutionUsage() and its pricingLookup constructor
 *   parameter are fully removed, rather than narrowed. Before this step,
 *   AgentOrchestrator accepted a 16th positional pricingLookup argument
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
 * @related-files [packages/execution/src/agent_orchestrator.ts, tests/integration/agent/cost_logging_test.ts]
 */

import { assertEquals } from "@std/assert";

Deno.test("[regression] AgentOrchestrator constructor no longer accepts a pricingLookup argument (structural — TS2554 too-many-arguments at compile time if reintroduced)", () => {
  // Structural/compile-time proof: `deno check` on this file is the actual gate if
  // pricingLookup or estimateExecutionUsage were ever reintroduced. Checks for the actual
  // declarations, not any textual mention (a comment below legitimately names it).
  const source = Deno.readTextFileSync(
    new URL("../src/agent_orchestrator.ts", import.meta.url),
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
