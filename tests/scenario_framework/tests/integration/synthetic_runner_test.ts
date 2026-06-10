/**
 * @module ScenarioFrameworkSyntheticRunnerIntegrationTest
 * @path tests/scenario_framework/tests/integration/synthetic_runner_test.ts
 * @description RED-first integration tests for Step 9. Verifies the
 * framework can execute synthetic scenarios end to end without a deployed
 * workspace, emit criterion-level manifests, pause and resume checkpoints, and
 * honor CI scenario selection rules.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts, tests/scenario_framework/runner/scenario_catalog.ts, tests/scenario_framework/runner/modes.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ScenarioExecutionMode, ScenarioStepType } from "../../schema/step_schema.ts";
import { SCHEMA_VERSION } from "../../schema/version.ts";
import { selectScenariosForExecution } from "../../runner/modes.ts";
import { loadScenarioCatalog } from "../../runner/scenario_catalog.ts";
import { runSyntheticScenario } from "../../runner/synthetic_runner.ts";
import {
  type ISyntheticScenarioStepDefinition,
  withSyntheticTestEnv,
  writeSyntheticScenario,
} from "./synthetic_test_helpers.ts";

Deno.test("[ScenarioFrameworkSyntheticRunner] synthetic scenario completes successfully without a deployed workspace", async () => {
  await withSyntheticTestEnv(async ({ frameworkHome, workspaceRoot, outputDir }) => {
    const scenarioPath = await writeSyntheticScenario({
      frameworkHome,
      scenarioId: "synthetic-success",
      tags: ["smoke", "synthetic"],
      schemaVersion: SCHEMA_VERSION,
      steps: [
        {
          id: "write-result",
          type: ScenarioStepType.SHELL,
          command: Deno.execPath(),
          args: [
            "eval",
            'await Deno.mkdir("artifacts", { recursive: true }); await Deno.writeTextFile("artifacts/result.json", JSON.stringify({ status: "ok" })); console.log("result-ready");',
          ],
          outputCriteriaLines: [
            '    - id: "result-file-created"',
            '      kind: "file-exists"',
            '      path: "artifacts/result.json"',
            '    - id: "result-status-ok"',
            '      kind: "json-path-equals"',
            '      path: "$.status"',
            '      equals: "ok"',
            '      target_file: "artifacts/result.json"',
          ],
        },
      ],
    });

    const run = await runSyntheticScenario({
      frameworkHome,
      scenarioPath,
      workspaceRoot,
      outputDir,
      mode: ScenarioExecutionMode.AUTO,
    });

    assertEquals(run.runResult.status, "completed");
    assertEquals(run.manifest.outcome, "success");
    assertEquals(run.manifest.steps.map((step: { executionStatus: string }) => step.executionStatus), ["passed"]);
  });
});

Deno.test("[ScenarioFrameworkSyntheticRunner] synthetic failing scenario emits the expected criterion-level manifest", async () => {
  await withSyntheticTestEnv(async ({ frameworkHome, workspaceRoot, outputDir }) => {
    const scenarioPath = await writeSyntheticScenario({
      frameworkHome,
      scenarioId: "synthetic-failure",
      tags: ["synthetic"],
      schemaVersion: SCHEMA_VERSION,
      steps: [
        {
          id: "write-bad-result",
          type: ScenarioStepType.SHELL,
          command: Deno.execPath(),
          args: [
            "eval",
            'await Deno.mkdir("artifacts", { recursive: true }); await Deno.writeTextFile("artifacts/result.json", JSON.stringify({ status: "broken" }));',
          ],
          outputCriteriaLines: [
            '    - id: "result-status-ok"',
            '      kind: "json-path-equals"',
            '      path: "$.status"',
            '      equals: "ok"',
            '      target_file: "artifacts/result.json"',
          ],
        },
      ],
    });

    const run = await runSyntheticScenario({
      frameworkHome,
      scenarioPath,
      workspaceRoot,
      outputDir,
      mode: ScenarioExecutionMode.AUTO,
    });

    // With partial scoring, criterion failures no longer halt the scenario.
    // The scenario completes with a partial score reflecting fail/pass rates.
    assertEquals(run.runResult.status, "completed");
    assertEquals(run.manifest.outcome, "success");
    assertEquals(run.manifest.steps[0].criterionResults[0].criterion_id, "result-status-ok");
    assertEquals(run.manifest.steps[0].criterionResults[0].status, "failed");
    assertEquals(run.manifest.suite_score, 0);
  });
});

Deno.test("[ScenarioFrameworkSyntheticRunner] synthetic checkpoint scenario pauses and resumes correctly", async () => {
  await withSyntheticTestEnv(async ({ frameworkHome, workspaceRoot, outputDir }) => {
    const scenarioPath = await writeSyntheticScenario({
      frameworkHome,
      scenarioId: "synthetic-checkpoint",
      tags: ["synthetic"],
      schemaVersion: SCHEMA_VERSION,
      steps: [
        {
          id: "step-one",
          type: ScenarioStepType.SHELL,
          command: Deno.execPath(),
          args: ["eval", 'await Deno.writeTextFile("step-one.txt", "one\n");'],
          outputCriteriaLines: [
            '    - id: "step-one-written"',
            '      kind: "file-exists"',
            '      path: "step-one.txt"',
          ],
        },
        {
          id: "step-two",
          type: ScenarioStepType.SHELL,
          command: Deno.execPath(),
          checkpoint: "review-synthetic-checkpoint",
          args: ["eval", 'await Deno.writeTextFile("step-two.txt", "two\n");'],
          outputCriteriaLines: [
            '    - id: "step-two-written"',
            '      kind: "file-exists"',
            '      path: "step-two.txt"',
          ],
        },
        {
          id: "step-three",
          type: ScenarioStepType.SHELL,
          command: Deno.execPath(),
          args: ["eval", 'await Deno.writeTextFile("step-three.txt", "three\n");'],
          outputCriteriaLines: [
            '    - id: "step-three-written"',
            '      kind: "file-exists"',
            '      path: "step-three.txt"',
          ],
        },
      ],
    });

    const firstRun = await runSyntheticScenario({
      frameworkHome,
      scenarioPath,
      workspaceRoot,
      outputDir,
      mode: ScenarioExecutionMode.MANUAL_CHECKPOINT,
    });

    assertEquals(firstRun.runResult.status, "paused");
    assertEquals(firstRun.runResult.nextStepIndex, 2);
    assertEquals(firstRun.runResult.reviewBundle?.checkpointId, "review-synthetic-checkpoint");

    const resumedRun = await runSyntheticScenario({
      frameworkHome,
      scenarioPath,
      workspaceRoot,
      outputDir,
      mode: ScenarioExecutionMode.MANUAL_CHECKPOINT,
      startStepIndex: firstRun.runResult.nextStepIndex,
    });

    assertEquals(resumedRun.runResult.status, "completed");
    assertEquals((await Deno.readTextFile(join(workspaceRoot, "step-three.txt"))).trim(), "three");
  });
});

Deno.test("[ScenarioFrameworkSyntheticRunner] synthetic CI scenario selection honors tags and explicit scenario ids", async () => {
  await withSyntheticTestEnv(async ({ frameworkHome }) => {
    await writeSyntheticScenario({
      frameworkHome,
      scenarioId: "synthetic-smoke",
      tags: ["smoke", "synthetic"],
      schemaVersion: SCHEMA_VERSION,
      steps: [createNoopStep("smoke-step")],
    });
    await writeSyntheticScenario({
      frameworkHome,
      scenarioId: "synthetic-manual",
      tags: ["manual-only"],
      schemaVersion: SCHEMA_VERSION,
      steps: [createNoopStep("manual-step")],
    });

    const catalog = await loadScenarioCatalog({ frameworkHome });

    const byTag = selectScenariosForExecution({
      scenarios: catalog,
      explicitTags: ["smoke"],
    });
    const byId = selectScenariosForExecution({
      scenarios: catalog,
      explicitScenarioIds: ["synthetic-manual"],
    });

    assertEquals(byTag.map((scenario) => scenario.id), ["synthetic-smoke"]);
    assertEquals(byId.map((scenario) => scenario.id), ["synthetic-manual"]);
  });
});

function createNoopStep(id: string): ISyntheticScenarioStepDefinition {
  return {
    id,
    type: ScenarioStepType.SHELL,
    command: Deno.execPath(),
    args: ["eval", 'console.log("noop");'],
    outputCriteriaLines: [
      '    - id: "noop-exit"',
      '      kind: "command-exit-code"',
      "      equals: 0",
    ],
  };
}
