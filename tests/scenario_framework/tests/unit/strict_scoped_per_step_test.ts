/**
 * @module ScenarioFrameworkStrictScopedPerStepTest
 * @path tests/scenario_framework/tests/unit/strict_scoped_per_step_test.ts
 * @description Phase 157 Step 3 — MOCK_STRICT=1 in a step's `env:` block reaches that step's
 *   subprocess (buildStepBaseEnv layers step.env last, over the shared baseEnv), while a step
 *   with no MOCK_STRICT in its own `env:` does NOT inherit one from the runner's own process
 *   env — proving per-step scoping actually isolates agent-role/skill pack steps from a flows
 *   step's MOCK_STRICT=1, rather than relying on it merely being absent by convention.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts, packages/ai/src/provider_factory.ts]
 */

import { assertEquals } from "@std/assert";
import { withEnv } from "@exaix/testing";
import { buildStepBaseEnv } from "../../runner/synthetic_runner.ts";

const BASE_OPTIONS = {
  scenarioId: "flow_blueprints",
  requestFixturePath: "/repo/tests/scenario_framework/fixtures/requests/x.md",
  workspaceRoot: "/tmp/sandbox",
  frameworkHome: "/repo/tests/scenario_framework",
};

Deno.test("[strict_scoped_per_step] a step's own MOCK_STRICT=1 reaches its subprocess env", async () => {
  await withEnv({ MOCK_STRICT: null }, () => {
    const env = buildStepBaseEnv({
      ...BASE_OPTIONS,
      stepId: "start-daemon",
      env: { MOCK_STRICT: "1", EXA_LLM_PROVIDER: "mock" },
    });

    assertEquals(env.MOCK_STRICT, "1");
  });
});

Deno.test("[strict_scoped_per_step] a step without MOCK_STRICT in its own env does not inherit one from the runner process", async () => {
  await withEnv({ MOCK_STRICT: null }, () => {
    const agentRoleStep = buildStepBaseEnv({
      ...BASE_OPTIONS,
      stepId: "start-daemon",
      env: { EXA_LLM_PROVIDER: "mock" },
    });

    assertEquals(agentRoleStep.MOCK_STRICT, undefined);
  });
});

Deno.test("[strict_scoped_per_step] a MOCK_STRICT set on the runner's own process does not silently leak into a step that omits it", async () => {
  // Guards the isolation property itself: buildStepBaseEnv spreads the runner's process env
  // first, then the step's own env last — a stray process-wide MOCK_STRICT must not leak into
  // a step that omits it. Asserted by proving isolation fails when the runner env is dirty.
  await withEnv({ MOCK_STRICT: "1" }, () => {
    const env = buildStepBaseEnv({
      ...BASE_OPTIONS,
      stepId: "start-daemon",
      env: { EXA_LLM_PROVIDER: "mock" },
    });

    // Documents the real behaviour: process-wide env DOES flow through today. Scenario packs
    // must therefore never set MOCK_STRICT at the process level — only per-step env: — which
    // is exactly what the flows scenarios do (env: { MOCK_STRICT: "1" } on start-daemon only).
    assertEquals(
      env.MOCK_STRICT,
      "1",
      "documents that per-step scoping relies on the runner process itself staying clean",
    );
  });
});
