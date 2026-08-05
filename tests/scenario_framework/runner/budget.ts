/**
 * @module ScenarioFrameworkBudget
 * @path tests/scenario_framework/runner/budget.ts
 * @description Phase 143 Step 4 — the `eval run --max-cost-usd` budget core. Design Decision 5:
 *   the cap stops scheduling, never truncates a running task. `BudgetTracker` accumulates each
 *   completed scenario's cost and signals that the remaining scenarios must be skipped once the
 *   accumulated total reaches the cap; `computeScenarioTotalCost` derives a scenario's cost from
 *   its manifest steps' tracked costs (absent cost is ignored, never treated as a zero-spend
 *   signal). A budget stop is NOT an infra error — the runner exits by completed-scenario scores
 *   and flags `budget_stopped` in the eval report.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/main.ts, tests/scenario_framework/tests/unit/budget_cap_test.ts]
 */

export interface IBudgetTrackerOptions {
  /** The `--max-cost-usd` cap. Absent ⇒ no budget stop. */
  maxCostUsd?: number;
}

/** Sum the defined tracked costs across a scenario's manifest steps (absent ⇒ not counted). */
export function computeScenarioTotalCost(
  steps: Array<{ trackedCostUsd?: number }>,
): number {
  return steps.reduce((acc, step) => acc + (step.trackedCostUsd ?? 0), 0);
}

/**
 * Accumulates per-scenario cost between scenarios of an eval run. `shouldStop` is checked
 * BEFORE scheduling the next scenario; `recordScenarioCost` runs AFTER a scenario completes.
 * With no `maxCostUsd`, the tracker never stops (budget is opt-in).
 */
export class BudgetTracker {
  readonly maxCostUsd?: number;
  private accumulated = 0;
  private stopped = false;

  constructor(options: IBudgetTrackerOptions = {}) {
    this.maxCostUsd = options.maxCostUsd;
  }

  /** True once accumulated cost reached the cap — remaining scenarios must be skipped. */
  get shouldStop(): boolean {
    return this.stopped;
  }

  /** The `budget_stopped: true` report flag. */
  get budgetStopped(): boolean {
    return this.stopped;
  }

  /** Total cost recorded so far. */
  get accumulatedCostUsd(): number {
    return this.accumulated;
  }

  /** Record a completed scenario's cost; if the cap is reached, stop scheduling. */
  recordScenarioCost(costUsd: number): void {
    this.accumulated += costUsd;
    if (this.maxCostUsd !== undefined && this.accumulated >= this.maxCostUsd) {
      this.stopped = true;
    }
  }
}
