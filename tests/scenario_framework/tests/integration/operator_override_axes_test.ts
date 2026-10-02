/**
 * @module OperatorOverrideAxesTest
 * @path tests/scenario_framework/tests/integration/operator_override_axes_test.ts
 * @description Phase 203 Step 26 — one real runner run proves Metric 1: operator `--overlay` and
 *   `--bind` layers change a flow step's service and a judge's service at once, from the operator
 *   layer, with the scenario file unchanged. The daemon's `binding.resolved` events show the flow
 *   step's service and `run.judges` shows the judge's service and request association.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/agent_flows/operator-override-axes.yaml, tests/scenario_framework/tests/integration/scenario_bindings_test.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withEnv } from "@exaix/testing";
import { runSyntheticScenario } from "../../runner/synthetic_runner.ts";
import { ScenarioExecutionMode } from "../../schema/step_schema.ts";
import { resolvedServiceByTrace, startCompatibleFixture, traceIdsInOrder } from "./synthetic_test_helpers.ts";

const FRAMEWORK_HOME = new URL("../../", import.meta.url).pathname;
const SCENARIO_REL = "scenarios/agent_flows/operator-override-axes.yaml";
const SCENARIO_ABS = join(FRAMEWORK_HOME, SCENARIO_REL);
const FIXTURE_MODEL = "compat-fixture-v1";
/** The operator overlay moves the flow step `explore-one` to svc-c. */
const OPERATOR_OVERLAY = join(FRAMEWORK_HOME, "fixtures", "phase203", "operator-explore-to-svc-c.json");
/** The operator bind moves the judge to svc-b, an axis the scenario set to svc-a. */
const OPERATOR_BIND = "judge=service=svc-b";

Deno.test({
  name:
    "[metric1] a real run with --overlay and --bind changes one flow step and the judge, and the scenario file is unchanged",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const fixture = startCompatibleFixture(FIXTURE_MODEL, "Exploration complete.");
    const port = (fixture.addr as Deno.NetAddr).port;
    const before = await Deno.readTextFile(SCENARIO_ABS);
    const workspaceRoot = await Deno.makeTempDir({ prefix: "phase203-axes-ws-" });
    const outputDir = await Deno.makeTempDir({ prefix: "phase203-axes-out-" });
    try {
      let run: Awaited<ReturnType<typeof runSyntheticScenario>> | undefined;
      await withEnv({ EXA_COMPAT_TEST_API_KEY: "phase203-fixture-key" }, async () => {
        run = await runSyntheticScenario({
          frameworkHome: FRAMEWORK_HOME,
          scenarioPath: SCENARIO_REL,
          workspaceRoot,
          outputDir,
          mode: ScenarioExecutionMode.AUTO,
          env: { EXA_COMPAT_FIXTURE_PORT: String(port) },
          operatorOverlays: [OPERATOR_OVERLAY],
          operatorBinds: [OPERATOR_BIND],
        });
      });
      assert(run, "runSyntheticScenario returned no result");

      // The operator overlay wins the flow step's service over the scenario layer's svc-a.
      const traces = await traceIdsInOrder(workspaceRoot);
      assertEquals(traces.length, 1, "one exactl request step on one daemon");
      const services = await resolvedServiceByTrace(workspaceRoot);
      assertEquals(
        services.get(traces[0])?.get("explore-one"),
        "svc-c",
        "the operator overlay moves explore-one to svc-c",
      );

      // The operator --bind wins the judge's service over the scenario layer's svc-a.
      assertEquals(run.judges?.length, 1, "one judge bearing step");
      const judge = run.judges![0]!;
      assertEquals(judge.stepId, "submit-request");
      assertEquals(judge.service, "svc-b", "the operator --bind moves the judge to svc-b");
      assertEquals(judge.requestStepId, "submit-request", "the judge names the request it grades");

      // The override came from the operator layers, never from an edit to the scenario.
      assertEquals(await Deno.readTextFile(SCENARIO_ABS), before, "the scenario file must be unchanged");
    } finally {
      await Deno.remove(workspaceRoot, { recursive: true }).catch(() => {});
      await Deno.remove(outputDir, { recursive: true }).catch(() => {});
      await fixture.shutdown();
    }
  },
});
