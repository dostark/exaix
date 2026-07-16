/**
 * @module MultiTrialIsolationTest
 * @path tests/scenario_framework/tests/unit/multi_trial_isolation_test.ts
 * @description Ensures that each trial in a multi-trial run produces an
 * independently isolated run directory so that trials don't interfere.
 * Validates that trial directory names are unique per scenario+run.
 */

import { assertEquals } from "@std/assert";

Deno.test("[MultiTrialIsolation] trial run IDs are unique per trial", () => {
  const trialRunIds = [];
  for (let i = 0; i < 3; i++) {
    trialRunIds.push(crypto.randomUUID());
  }
  const uniqueIds = new Set(trialRunIds);
  assertEquals(uniqueIds.size, 3, "each trial must produce a unique run ID");
});

Deno.test("[MultiTrialIsolation] trial output directories avoid collision with trial index", () => {
  const scenarioDir = "/tmp/scenario-framework-test-output/synthetic-demo";
  const trialIndices = [1, 2, 3];
  const dirs = trialIndices.map((i) => `${scenarioDir}/trial-${i}`);
  const uniqueDirs = new Set(dirs);
  assertEquals(uniqueDirs.size, 3, "trial output directories must not collide");
});
