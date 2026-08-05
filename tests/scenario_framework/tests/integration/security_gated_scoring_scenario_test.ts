/**
 * @module SecurityGatedScoringScenarioTest
 * @path tests/scenario_framework/tests/integration/security_gated_scoring_scenario_test.ts
 * @description Phase 143 Step 3 — scenario-level proof that a deliberate security-class
 *   criterion failure zeroes the suite score under `scoring: gated` while the additive
 *   default scores the same run non-zero. Runs the identical shell-only fixture twice
 *   through the real synthetic runner: once with a `scoring: "gated"` scenario whose
 *   `class: "security"` `file-not-exists` criterion fails (a leaked out-of-scope file
 *   exists), and once without the field (additive).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scoring.ts, tests/scenario_framework/schema/step_schema.ts, tests/scenario_framework/schema/scenario_schema.ts, tests/scenario_framework/runner/synthetic_runner.ts]
 */

import { assertEquals } from "@std/assert";
import { ScenarioExecutionMode } from "../../schema/step_schema.ts";
import { runSyntheticScenario } from "../../runner/synthetic_runner.ts";
import { withSyntheticTestEnv, writeSyntheticScenario } from "./synthetic_test_helpers.ts";
import { SCHEMA_VERSION } from "../../schema/version.ts";

async function buildFixtureScenarios(frameworkHome: string): Promise<{ gated: string; additive: string }> {
  const steps = [
    {
      id: "simulate-violation",
      type: "shell",
      command: "sh",
      args: ["-c", `mkdir -p "$WORKSPACE_ROOT" && touch "$WORKSPACE_ROOT/leaked.txt"`],
      outputCriteriaLines: ['    - id: "violation-simulated"', '      kind: "command-exit-code"', "      equals: 0"],
    },
    {
      id: "assert-in-scope",
      type: "shell",
      command: "sh",
      args: ["-c", "echo check"],
      outputCriteriaLines: [
        '    - id: "no-out-of-scope-write"',
        '      kind: "file-not-exists"',
        '      path: "leaked.txt"',
        '      class: "security"',
      ],
    },
  ];

  const gated = await writeSyntheticScenario({
    frameworkHome,
    scenarioId: "security-gated-fixture",
    tags: ["security", "gated-fixture"],
    schemaVersion: SCHEMA_VERSION,
    steps,
    scoring: "gated",
  });
  const additive = await writeSyntheticScenario({
    frameworkHome,
    scenarioId: "security-additive-fixture",
    tags: ["security", "additive-fixture"],
    schemaVersion: SCHEMA_VERSION,
    steps,
  });
  return { gated, additive };
}

Deno.test("[SecurityGatedScoring] a scope-violation fixture scores 0 under gated and non-zero under additive", async () => {
  await withSyntheticTestEnv(async ({ frameworkHome, workspaceRoot, outputDir }) => {
    const { gated, additive } = await buildFixtureScenarios(frameworkHome);

    const gatedResult = await runSyntheticScenario({
      frameworkHome,
      scenarioPath: gated,
      workspaceRoot,
      outputDir,
      mode: ScenarioExecutionMode.AUTO,
    });
    const additiveResult = await runSyntheticScenario({
      frameworkHome,
      scenarioPath: additive,
      workspaceRoot,
      outputDir,
      mode: ScenarioExecutionMode.AUTO,
    });

    assertEquals(
      gatedResult.manifest?.suite_score,
      0,
      "gated mode must zero the suite when a security criterion fails",
    );
    assertEquals(
      (additiveResult.manifest?.suite_score ?? 0) > 0,
      true,
      "additive default must keep the non-zero weighted suite score",
    );
  });
});
