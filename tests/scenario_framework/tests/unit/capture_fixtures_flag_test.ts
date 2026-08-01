/**
 * @module ScenarioFrameworkCaptureFixturesFlagTest
 * @path tests/scenario_framework/tests/unit/capture_fixtures_flag_test.ts
 * @description Phase 157 Step 2 — `--capture-fixtures <dir>` resolves to an absolute path and
 *   exports it as EXA_CAPTURE_FIXTURES_DIR in the runner's OWN process env, so every spawned
 *   step subprocess inherits it (buildStepBaseEnv's existing `...Deno.env.toObject()` spread)
 *   — including the daemon-start step, which is where the daemon actually constructs the
 *   provider ProviderFactory wraps in CaptureRecordingProvider.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/capture_fixtures_flag.ts, tests/scenario_framework/runner/main.ts]
 */

import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { withEnv } from "@exaix/testing";
import { applyCaptureFixturesFlag, CAPTURE_FIXTURES_ENV_VAR } from "../../runner/capture_fixtures_flag.ts";

Deno.test("[capture_fixtures_flag] resolves the given dir to an absolute path and exports it", async () => {
  await withEnv({ [CAPTURE_FIXTURES_ENV_VAR]: null }, () => {
    applyCaptureFixturesFlag("./my-fixtures");
    assertEquals(Deno.env.get(CAPTURE_FIXTURES_ENV_VAR), resolve("./my-fixtures"));
  });
});

Deno.test("[capture_fixtures_flag] is a no-op when no dir is given", async () => {
  await withEnv({ [CAPTURE_FIXTURES_ENV_VAR]: null }, () => {
    applyCaptureFixturesFlag(undefined);
    assertEquals(Deno.env.get(CAPTURE_FIXTURES_ENV_VAR), undefined);
  });
});
