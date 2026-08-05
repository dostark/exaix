/**
 * @module BudgetCapTest
 * @path tests/scenario_framework/tests/unit/budget_cap_test.ts
 * @description Phase 143 Step 4 — RED-first tests for `eval run --max-cost-usd`'s core:
 *   `BudgetTracker` accumulates per-scenario cost and signals that scheduling must stop once
 *   the accumulated total reaches the cap (Design Decision 5: the cap stops scheduling, never
 *   truncates a running task), and `computeScenarioTotalCost` derives a scenario's cost from
 *   its manifest steps' tracked costs (absent costs are ignored, never treated as zero-spend
 *   evidence). A budget stop is NOT an infra error — the run exits by completed-scenario scores
 *   with `budget_stopped` flagged in the report.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/budget.ts, tests/scenario_framework/runner/main.ts]
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { BudgetTracker, computeScenarioTotalCost } from "../../runner/budget.ts";

Deno.test("[BudgetCap] scenarios below the cap keep running", () => {
  const tracker = new BudgetTracker({ maxCostUsd: 1.0 });
  tracker.recordScenarioCost(0.3);
  assertEquals(tracker.budgetStopped, false);
  tracker.recordScenarioCost(0.4);
  assertEquals(tracker.budgetStopped, false);
  assertEquals(tracker.shouldStop, false, "accumulated 0.7 < cap 1.0");
});

Deno.test("[BudgetCap] accumulated cost reaching the cap stops scheduling", () => {
  const tracker = new BudgetTracker({ maxCostUsd: 0.5 });
  tracker.recordScenarioCost(0.3);
  tracker.recordScenarioCost(0.2);
  assertEquals(tracker.budgetStopped, true, "0.3 + 0.2 = 0.5 >= cap 0.5");
  assertEquals(tracker.shouldStop, true, "remaining scenarios must be skipped");
});

Deno.test("[BudgetCap] crossing the cap mid-run stops the remaining scenarios", () => {
  const tracker = new BudgetTracker({ maxCostUsd: 0.5 });
  tracker.recordScenarioCost(0.4);
  assertEquals(tracker.shouldStop, false);
  tracker.recordScenarioCost(0.4);
  assertEquals(tracker.shouldStop, true, "0.8 > cap 0.5 after the second scenario");
});

Deno.test("[BudgetCap] zero-cost scenarios never breach the cap", () => {
  const tracker = new BudgetTracker({ maxCostUsd: 0.01 });
  tracker.recordScenarioCost(0);
  tracker.recordScenarioCost(0);
  tracker.recordScenarioCost(0);
  assertEquals(tracker.budgetStopped, false);
  assertEquals(tracker.accumulatedCostUsd, 0);
});

Deno.test("[BudgetCap] no max-cost-usd means no budget stop", () => {
  const tracker = new BudgetTracker();
  tracker.recordScenarioCost(10);
  tracker.recordScenarioCost(10);
  assertEquals(tracker.budgetStopped, false, "no cap configured");
});

Deno.test("[BudgetCap] accumulated cost is tracked across scenarios", () => {
  const tracker = new BudgetTracker({ maxCostUsd: 10 });
  tracker.recordScenarioCost(1.25);
  tracker.recordScenarioCost(2.75);
  assertEquals(tracker.accumulatedCostUsd, 4);
});

Deno.test("[BudgetCap] computeScenarioTotalCost sums only defined tracked costs", () => {
  const steps = [
    { trackedCostUsd: 0.1 },
    { trackedCostUsd: 0.2 },
    {},
    { trackedCostUsd: undefined },
  ];
  assertAlmostEquals(computeScenarioTotalCost(steps), 0.3, 1e-9, "absent cost ignored, not zeroed");
});

Deno.test("[BudgetCap] computeScenarioTotalCost is 0 when nothing is tracked", () => {
  assertEquals(computeScenarioTotalCost([]), 0);
  assertEquals(computeScenarioTotalCost([{}, { trackedCostUsd: undefined }]), 0);
});
