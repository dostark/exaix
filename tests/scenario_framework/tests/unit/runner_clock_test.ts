/**
 * @module ScenarioFrameworkRunnerClockTest
 * @path tests/scenario_framework/tests/unit/runner_clock_test.ts
 * @description Pins the runner's monotonic clock: a host wall-clock step must never move a
 * runner timestamp backwards, because step durations and evidence windows depend on it.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/clock.ts, tests/scenario_framework/runner/step_executor.ts]
 */

import { assert } from "@std/assert";
import { monotonicNowMs } from "../../runner/clock.ts";

Deno.test("[RunnerClock] a backward wall-clock step never moves the runner clock backwards", async () => {
  const realDateNow = Date.now;
  try {
    const before = monotonicNowMs();
    Date.now = () => realDateNow() - 5_000;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = monotonicNowMs();
    assert(after > before, `runner clock moved backwards: ${before} -> ${after}`);
    assert(after >= before + 20, `runner clock did not advance: ${before} -> ${after}`);
  } finally {
    Date.now = realDateNow;
  }
});

Deno.test("[RunnerClock] the runner clock tracks elapsed monotonic time across many reads", async () => {
  const start = monotonicNowMs();
  let previous = start;
  for (let index = 0; index < 200; index++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    const now = monotonicNowMs();
    assert(now >= previous, `runner clock went backwards at read ${index}: ${previous} -> ${now}`);
    previous = now;
  }
  assert(previous - start >= 150, `runner clock under-counted elapsed time: ${previous - start}ms`);
});

Deno.test("[RunnerClock] every runner clock reading is a whole millisecond", () => {
  // The eval-history schema stores step durations as safe integers.
  // A fractional reading makes the writer reject the whole entry.
  // The run then loses its history row.
  for (let index = 0; index < 50; index++) {
    const now = monotonicNowMs();
    assert(Number.isInteger(now), `runner clock returned a fractional reading: ${now}`);
  }
});
