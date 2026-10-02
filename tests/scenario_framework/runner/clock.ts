/**
 * @module ScenarioFrameworkRunnerClock
 * @path tests/scenario_framework/runner/clock.ts
 * @description Monotonic wall-clock source for the scenario runner. The host clock can step
 * backwards, so step durations and evidence windows must not read Date.now() directly.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/step_executor.ts]
 */

/** Wall clock at module load, paired with the monotonic origin to keep readings epoch-shaped. */
const EPOCH_ANCHOR_MS = Date.now();
const MONOTONIC_ORIGIN_MS = performance.now();

/** Whole milliseconds since the epoch, advanced by a monotonic source.
 *  A host clock step therefore cannot move a runner timestamp backwards.
 *  Rounding keeps each reading integral, as the eval-history schema requires. */
export function monotonicNowMs(): number {
  return Math.round(EPOCH_ANCHOR_MS + (performance.now() - MONOTONIC_ORIGIN_MS));
}
