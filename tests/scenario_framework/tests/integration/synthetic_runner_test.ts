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
import { withEnv } from "@exaix/testing";
import { ScenarioExecutionMode, ScenarioStepType } from "../../schema/step_schema.ts";
import { SCHEMA_VERSION } from "../../schema/version.ts";
import { selectScenariosForExecution } from "../../runner/modes.ts";
import { loadScenarioCatalog } from "../../runner/scenario_catalog.ts";
import { buildStepBaseEnv, runSyntheticScenario } from "../../runner/synthetic_runner.ts";
import { CAPTURE_FIXTURES_ENV_VAR } from "../../runner/capture_fixtures_flag.ts";
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

Deno.test("[ScenarioFrameworkSyntheticRunner] creates the workspace dir when it does not yet exist (sibling-default sandbox)", async () => {
  // Regression: the sibling-of-repo sandbox default produces a workspace_path that does NOT exist
  // yet (`<base>/exaix-sandboxes/<run-id>`). A non-matrix scenario must still create it before the
  // first step runs — otherwise the step executor spawns with a non-existent cwd and fails ENOENT
  // ("No such cwd"). Earlier tests always passed a pre-created makeTempDir, hiding this path.
  await withSyntheticTestEnv(async ({ frameworkHome, outputDir }) => {
    // A workspace path that is intentionally NOT created up front.
    const uncreatedWorkspace = await Deno.makeTempDir({ prefix: "scenario-uncreated-" });
    await Deno.remove(uncreatedWorkspace, { recursive: true }); // ensure it does not exist

    const scenarioPath = await writeSyntheticScenario({
      frameworkHome,
      scenarioId: "synthetic-uncreated-workspace",
      tags: ["smoke", "synthetic"],
      schemaVersion: SCHEMA_VERSION,
      steps: [
        {
          id: "echo-step",
          type: ScenarioStepType.SHELL,
          command: Deno.execPath(),
          args: ["eval", 'console.log("ran-in-workspace");'],
          outputCriteriaLines: [
            '    - id: "ran"',
            '      kind: "command-exit-code"',
            "      equals: 0",
          ],
        },
      ],
    });

    const run = await runSyntheticScenario({
      frameworkHome,
      scenarioPath,
      workspaceRoot: uncreatedWorkspace,
      outputDir,
      mode: ScenarioExecutionMode.AUTO,
    });

    // The run must succeed (no ENOENT on cwd) AND the workspace dir must now exist.
    assertEquals(run.manifest.outcome, "success");
    assertEquals((await Deno.stat(uncreatedWorkspace)).isDirectory, true);

    await Deno.remove(uncreatedWorkspace, { recursive: true }).catch(() => {});
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
    // The scenario progresses through all steps but reports final status "failed"
    // when any criterion failed (honest outcome), rather than silently succeeding.
    assertEquals(run.runResult.status, "failed");
    assertEquals(run.manifest.outcome, "scenario-failure");
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

Deno.test("[ScenarioFrameworkSyntheticRunner] buildStepBaseEnv rewrites the capture fixtures dir into the sandbox", async () => {
  await withEnv({
    [CAPTURE_FIXTURES_ENV_VAR]: "/repo/tests/scenario_framework/fixtures/mock_recordings/flow_blueprints",
  }, () => {
    const env = buildStepBaseEnv({
      scenarioId: "synthetic-capture",
      stepId: "start-daemon",
      requestFixturePath: "/tmp/request.json",
      workspaceRoot: "/sandbox/ws",
      frameworkHome: "/sandbox",
    });
    assertEquals(env[CAPTURE_FIXTURES_ENV_VAR], "/sandbox/ws/fixtures/mock_recordings/flow_blueprints");
  });
});

Deno.test("[ScenarioFrameworkSyntheticRunner] stops a started daemon even when a later step fails execution before reaching stop-daemon", async () => {
  await withSyntheticTestEnv(async ({ frameworkHome, workspaceRoot, outputDir }) => {
    const invocationLog = join(workspaceRoot, "exactl-invocations.log");
    const fakeExactl = await writeFakeExactl(workspaceRoot, invocationLog);

    const scenarioPath = await writeSyntheticScenario({
      frameworkHome,
      scenarioId: "synthetic-daemon-leak-guard",
      tags: ["synthetic"],
      schemaVersion: SCHEMA_VERSION,
      steps: [
        {
          id: "start-daemon",
          type: ScenarioStepType.EXACTL,
          command: "daemon",
          args: ["start"],
          outputCriteriaLines: [
            '    - id: "started"',
            '      kind: "command-exit-code"',
            "      equals: 0",
          ],
        },
        {
          id: "run-tests",
          type: ScenarioStepType.SHELL,
          command: Deno.execPath(),
          args: ["eval", "Deno.exit(1);"],
          outputCriteriaLines: [
            '    - id: "tests-passed"',
            '      kind: "command-exit-code"',
            "      equals: 0",
          ],
        },
        {
          id: "stop-daemon",
          type: ScenarioStepType.EXACTL,
          command: "daemon",
          args: ["stop"],
          outputCriteriaLines: [
            '    - id: "stopped"',
            '      kind: "command-exit-code"',
            "      equals: 0",
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
      exactlExecutable: fakeExactl,
    });

    // run-tests fails execution, so runScenarioInMode returns before the scenario's own
    // stop-daemon step ever runs — the run itself must still report the execution failure.
    assertEquals(run.runResult.status, "failed");
    assertEquals(run.runResult.executedStepIds, ["start-daemon", "run-tests"]);

    // Teardown must have force-invoked `daemon stop` anyway, so no daemon process leaks
    // out of this run regardless of where scenario execution stopped.
    const invocations = (await Deno.readTextFile(invocationLog)).trim().split("\n");
    assertEquals(invocations.includes("daemon stop"), true);
  });
});

async function writeFakeExactl(workspaceRoot: string, invocationLog: string): Promise<string> {
  const scriptPath = join(workspaceRoot, "fake-exactl.ts");
  await Deno.writeTextFile(
    scriptPath,
    [
      `const logPath = ${JSON.stringify(invocationLog)};`,
      'const line = Deno.args.join(" ") + "\\n";',
      "await Deno.writeTextFile(logPath, line, { append: true, create: true });",
      'console.log("daemon.started");',
      'console.log("daemon.stopped");',
    ].join("\n"),
  );

  const wrapperPath = join(workspaceRoot, "fake-exactl");
  await Deno.writeTextFile(
    wrapperPath,
    `#!/bin/sh\nexec "${Deno.execPath()}" run --allow-read --allow-write "${scriptPath}" "$@"\n`,
  );
  await Deno.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

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
