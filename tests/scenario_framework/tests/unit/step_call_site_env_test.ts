/**
 * @module ScenarioFrameworkStepCallSiteEnvTest
 * @path tests/scenario_framework/tests/unit/step_call_site_env_test.ts
 * @description Phase 157 Step 1 — the runner exports EXA_SCENARIO_ID/EXA_STEP_ID per step so a
 *   `submit-request` step's `exactl request --file` subprocess can stamp them into the created
 *   request's frontmatter. This is the transport's runner end: buildStepBaseEnv is the pure
 *   function executeSyntheticStep uses to compose the spawned process's env; extracted so this
 *   can be asserted directly without spawning a real daemon or exactl process.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts]
 */

import { assertEquals } from "@std/assert";
import { buildStepBaseEnv } from "../../runner/synthetic_runner.ts";

Deno.test("[step_call_site_env] buildStepBaseEnv sets EXA_SCENARIO_ID and EXA_STEP_ID", () => {
  const env = buildStepBaseEnv({
    scenarioId: "flow_blueprints",
    stepId: "submit-request",
    requestFixturePath: "/repo/tests/scenario_framework/fixtures/requests/x.md",
    workspaceRoot: "/tmp/sandbox",
    frameworkHome: "/repo/tests/scenario_framework",
  });

  assertEquals(env.EXA_SCENARIO_ID, "flow_blueprints");
  assertEquals(env.EXA_STEP_ID, "submit-request");
});

Deno.test("[step_call_site_env] a step's own env cannot override EXA_SCENARIO_ID/EXA_STEP_ID", () => {
  const env = buildStepBaseEnv({
    scenarioId: "flow_blueprints",
    stepId: "submit-request",
    requestFixturePath: "/repo/tests/scenario_framework/fixtures/requests/x.md",
    workspaceRoot: "/tmp/sandbox",
    frameworkHome: "/repo/tests/scenario_framework",
    env: { EXA_SCENARIO_ID: "spoofed", EXA_LLM_PROVIDER: "mock" },
  });

  assertEquals(env.EXA_SCENARIO_ID, "flow_blueprints", "the runner's own scenario id must win");
  assertEquals(env.EXA_LLM_PROVIDER, "mock", "unrelated step.env values still pass through");
});

Deno.test("[step_call_site_env] existing REQUEST_FIXTURE/FRAMEWORK_HOME substitution is unaffected (regression)", () => {
  const env = buildStepBaseEnv({
    scenarioId: "flow_blueprints",
    stepId: "submit-request",
    requestFixturePath: "/repo/tests/scenario_framework/fixtures/requests/x.md",
    workspaceRoot: "/tmp/sandbox",
    frameworkHome: "/repo/tests/scenario_framework",
  });

  assertEquals(env.REQUEST_FIXTURE, "/repo/tests/scenario_framework/fixtures/requests/x.md");
  assertEquals(env.WORKSPACE_ROOT, "/tmp/sandbox");
  assertEquals(env.FRAMEWORK_HOME, "/repo/tests/scenario_framework");
});
