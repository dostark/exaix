/**
 * @module ScenarioFrameworkMatrixRunnerWiringTest
 * @path tests/scenario_framework/tests/unit/matrix_runner_wiring_test.ts
 * @description Phase 127 Step 5 — RED-first tests for the runner-level matrix wiring.
 *   The Step 2 expandMatrix() must be reachable from the real runner (synthetic_runner.ts),
 *   not just from unit tests — closing its Reachability Ledger row. `resolveRunnableSteps`
 *   is that integration seam: given a loaded scenario + env, it returns the matrix-expanded
 *   runnable steps (overlaying the cell's EXA_CONFIG_PATH/tool) when a `matrix:` block is
 *   present, or the scenario's own steps unchanged otherwise. The full provider-live
 *   per-cell execution against real delegate binaries is gated/manual (see the phase doc
 *   Success Metrics); this test proves the wiring path exists and is deterministic.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/matrix_expander.ts, tests/scenario_framework/runner/synthetic_runner.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import {
  MATRIX_START_DAEMON_STEP_ID,
  type MatrixCellStatusValue,
  resolveRunnableSteps,
} from "../../runner/matrix_expander.ts";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const MATRIX_SCENARIO = join(
  REPO_ROOT,
  "tests/scenario_framework/scenarios/provider_live/session_delegate_matrix_live.yaml",
);
const NON_MATRIX_SCENARIO = join(
  REPO_ROOT,
  "tests/scenario_framework/scenarios/provider_live/session_delegate_plan_review_live.yaml",
);

async function loadScenario(path: string): Promise<ReturnType<typeof ScenarioSchema.parse>> {
  return ScenarioSchema.parse(parseYaml(await Deno.readTextFile(path)));
}

Deno.test("[matrix_runner] resolveRunnableSteps with a matrix block returns one runnable group per runnable cell", async () => {
  const scenario = await loadScenario(MATRIX_SCENARIO);
  const groups = resolveRunnableSteps(scenario, {
    env: { OPENROUTER_API_KEY: "k", ANTHROPIC_API_KEY: "k", EXA_MATRIX_OPENCODE: "1" },
    binOnPath: () => true,
  });
  // 4 cells all runnable → 4 groups, each carrying the cell's overlaid steps.
  assertEquals(groups.length, 4);
  for (const g of groups) {
    const status: MatrixCellStatusValue = g.status;
    assertEquals(status, "run");
    assert(g.cell, "a matrix group must carry its cell");
    const daemon = g.steps.find((s) => s.id === MATRIX_START_DAEMON_STEP_ID);
    assert(daemon, "each runnable group carries the overlaid start-daemon step");
    assertEquals(daemon.env?.EXA_CONFIG_PATH, g.cell.config);
  }
});

Deno.test("[matrix_runner] resolveRunnableSteps skips cells whose prerequisites are absent", async () => {
  const scenario = await loadScenario(MATRIX_SCENARIO);
  const groups = resolveRunnableSteps(scenario, {
    env: {}, // no keys, no opt-in
    binOnPath: () => false, // no binaries
  });
  assertEquals(groups.length, 4);
  for (const g of groups) assertEquals(g.status, "skip");
});

Deno.test("[matrix_runner] resolveRunnableSteps on a non-matrix scenario returns a single pass-through group with the original steps", async () => {
  const scenario = await loadScenario(NON_MATRIX_SCENARIO);
  const groups = resolveRunnableSteps(scenario, { env: {}, binOnPath: () => true });
  assertEquals(groups.length, 1, "a matrix-less scenario yields exactly one group");
  assertEquals(groups[0].status, "run");
  assertEquals(groups[0].steps, scenario.steps, "pass-through group preserves the scenario's own steps");
  assertEquals(groups[0].cell, undefined, "pass-through group has no cell");
});

Deno.test("[matrix_runner] the synthetic runner imports the matrix resolver (expandMatrix is reachable from production runner code)", async () => {
  // Reachability proof: the runner module must consume the matrix resolver so expandMatrix
  // is invoked by a real run, not only by tests (closes the Reachability Ledger row).
  const runnerSrc = await Deno.readTextFile(
    join(REPO_ROOT, "tests/scenario_framework/runner/synthetic_runner.ts"),
  );
  assert(
    runnerSrc.includes("resolveRunnableSteps") || runnerSrc.includes("matrix_expander"),
    "synthetic_runner.ts must import the matrix resolver so expandMatrix is reachable from the runner",
  );
});
