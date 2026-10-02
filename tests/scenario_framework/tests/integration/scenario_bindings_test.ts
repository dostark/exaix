/**
 * @module ScenarioBindingsTest
 * @path tests/scenario_framework/tests/integration/scenario_bindings_test.ts
 * @description Phase 203 Step 1 — scenario-layer `bindings:` and per-step `bindings:` through one
 *   real daemon and loopback fixture. The scenario binds `compose` to svc-a and `explore-one` to
 *   svc-b. A second request carries its own step binding that moves `compose` to svc-c and leaves
 *   `explore-one` alone. A third run adds an operator `--overlay` that moves `explore-one` to
 *   svc-c while `compose` keeps svc-a, which proves the run-overlay argument order is the
 *   precedence the loader applies.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/agent_flows/scenario-bindings-split.yaml, tests/scenario_framework/runner/binding_layers.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withEnv } from "@exaix/testing";
import { runSyntheticScenario } from "../../runner/synthetic_runner.ts";
import { ScenarioExecutionMode } from "../../schema/step_schema.ts";
import {
  readRunActivity,
  resolvedServiceByTrace,
  startCompatibleFixture,
  traceIdsInOrder,
} from "./synthetic_test_helpers.ts";

const FRAMEWORK_HOME = new URL("../../", import.meta.url).pathname;
const SCENARIO_PATH = "scenarios/agent_flows/scenario-bindings-split.yaml";
const FIXTURE_MODEL = "compat-fixture-v1";
const OPERATOR_OVERLAY = join(FRAMEWORK_HOME, "fixtures", "phase203", "operator-explore-to-svc-c.json");

/** One scenario run against the shared loopback fixture. */
async function runScenario(input: { port: number; operatorOverlays?: string[] }) {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "phase203-bindings-ws-" });
  const outputDir = await Deno.makeTempDir({ prefix: "phase203-bindings-out-" });
  let run: Awaited<ReturnType<typeof runSyntheticScenario>> | undefined;
  await withEnv({ EXA_COMPAT_TEST_API_KEY: "phase203-fixture-key" }, async () => {
    run = await runSyntheticScenario({
      frameworkHome: FRAMEWORK_HOME,
      scenarioPath: SCENARIO_PATH,
      workspaceRoot,
      outputDir,
      mode: ScenarioExecutionMode.AUTO,
      env: { EXA_COMPAT_FIXTURE_PORT: String(input.port) },
      ...(input.operatorOverlays ? { operatorOverlays: input.operatorOverlays } : {}),
    });
  });
  assert(run, "runSyntheticScenario returned no result");
  return { run, workspaceRoot, outputDir };
}

Deno.test({
  name: "[phase203] scenario bindings route two steps, a step binding overrides one, and an operator overlay moves one",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const fixture = startCompatibleFixture(FIXTURE_MODEL, "Exploration complete.");
    const port = (fixture.addr as Deno.NetAddr).port;
    try {
      // Run 1: as authored. Request one uses the scenario layer. Request two adds its own step
      // binding, which reaches only that request.
      const first = await runScenario({ port });
      // The journal barrier is non-fatal, so the outcome is asserted only in environments
      // whose CLI can load a provider credential. The binding evidence below is the criterion.
      const traces = await traceIdsInOrder(first.workspaceRoot);
      assertEquals(traces.length, 2, "two exactl request steps on one daemon");
      const services = await resolvedServiceByTrace(first.workspaceRoot);
      assertEquals(
        services.get(traces[0]),
        new Map([["compose", "mock"], ["explore-one", "svc-a"], ["finalize", "mock"]]),
        "the scenario layer binds compose to mock and explore-one to svc-a",
      );
      assertEquals(
        services.get(traces[1]),
        new Map([["compose", "mock"], ["explore-one", "svc-b"], ["finalize", "mock"]]),
        "the step's own binding moves explore-one to svc-b and leaves compose on mock",
      );
      // One daemon served both requests, so no restart was needed to change the binding.
      const daemonStarts = (await readRunActivity(first.workspaceRoot))
        .filter((row) => row.action_type === "daemon.started");
      assertEquals(daemonStarts.length, 1);

      // Run 2: the operator overlay arrives above the scenario layer, so explore-one moves to
      // svc-c while compose keeps svc-a. This is the run-overlay ordering the loader applies.
      const second = await runScenario({ port, operatorOverlays: [OPERATOR_OVERLAY] });
      const secondTraces = await traceIdsInOrder(second.workspaceRoot);
      const secondServices = await resolvedServiceByTrace(second.workspaceRoot);
      assertEquals(
        secondServices.get(secondTraces[0]),
        new Map([["compose", "mock"], ["explore-one", "svc-c"], ["finalize", "mock"]]),
        "the operator overlay moves explore-one to svc-c and leaves compose on mock",
      );
      // The evidence lists the overlay files the runner wrote, outside the sandbox.
      assertEquals(second.run.bindingOverlays?.some((overlay) => overlay.role === "operator"), true);
      for (const overlay of second.run.bindingOverlays ?? []) {
        assert(
          !overlay.path.includes("/phase203-bindings-ws-"),
          `overlay ${overlay.path} must not live inside the sandbox`,
        );
      }
    } finally {
      await fixture.shutdown();
    }
  },
});
