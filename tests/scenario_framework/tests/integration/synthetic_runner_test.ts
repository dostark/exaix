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

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withEnv } from "@exaix/testing";
import { CriterionStatus, ScenarioExecutionMode, ScenarioStepType } from "../../schema/step_schema.ts";
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
  // yet. A non-matrix scenario must still create it before the first step runs, or the step
  // executor spawns with a non-existent cwd and fails ENOENT ("No such cwd").
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

Deno.test("[ScenarioFrameworkSyntheticRunner] a from_catalog matrix resolves its preset and carries the cell overlay to the request step", async () => {
  await withSyntheticTestEnv(async ({ frameworkHome, workspaceRoot, outputDir }) => {
    const invocationLog = join(workspaceRoot, "exactl-invocations.log");
    const fakeExactl = await writeFakeExactl(workspaceRoot, invocationLog);

    const scenarioPath = await writeSyntheticScenario({
      frameworkHome,
      scenarioId: "synthetic-from-catalog",
      tags: ["synthetic"],
      schemaVersion: SCHEMA_VERSION,
      fromCatalog: ["exactl-native"],
      steps: [
        {
          id: "start-daemon",
          type: ScenarioStepType.EXACTL,
          command: "daemon",
          args: ["start"],
          outputCriteriaLines: ['    - id: "started"', '      kind: "command-exit-code"', "      equals: 0"],
        },
        {
          id: "submit-request",
          type: ScenarioStepType.EXACTL,
          command: "request",
          args: ["--file", "$REQUEST_FIXTURE"],
          outputCriteriaLines: ['    - id: "submitted"', '      kind: "command-exit-code"', "      equals: 0"],
        },
        {
          id: "stop-daemon",
          type: ScenarioStepType.EXACTL,
          command: "daemon",
          args: ["stop"],
          outputCriteriaLines: ['    - id: "stopped"', '      kind: "command-exit-code"', "      equals: 0"],
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
      // The preset gates on ANTHROPIC_API_KEY. No provider call happens here.
      env: { ANTHROPIC_API_KEY: "synthetic-test-key" },
    });

    // The history cell id still comes from the preset's tool and the config's own provider.
    assertEquals(run.manifest.cellId, "exactl-anthropic");
    assertEquals(run.manifest.provider, "anthropic");

    // The preset's default binding becomes the cell layer, written outside the sandbox.
    const cellOverlay = run.bindingOverlays?.find((overlay) => overlay.role === "cell");
    assertEquals(cellOverlay?.path.endsWith("20-cell.json"), true);
    const written = JSON.parse(await Deno.readTextFile(cellOverlay!.path)) as {
      bindings?: { default?: { model?: string } };
    };
    assertEquals(written.bindings?.default?.model, "anthropic/claude-sonnet-5");

    // The cell overlay reaches the request step as an --overlay argument.
    const invocations = (await Deno.readTextFile(invocationLog)).trim().split("\n");
    const requestLine = invocations.find((line) => line.startsWith("request "));
    assertEquals(requestLine?.includes("--overlay"), true, `request step must carry --overlay: ${requestLine}`);
    assertEquals(requestLine?.includes("20-cell.json"), true);
  });
});

Deno.test("[ScenarioFrameworkSyntheticRunner] fix-bug-null-guard runs from from_catalog with an unchanged cell id", async () => {
  // The real shipped scenario, resolved against the real shipped eval cell catalog.
  const frameworkHome = fromFileUrl(new URL("../../", import.meta.url));
  const workspaceRoot = await Deno.makeTempDir({ prefix: "scenario-swe-catalog-" });
  const outputDir = await Deno.makeTempDir({ prefix: "scenario-swe-catalog-out-" });
  try {
    const invocationLog = join(workspaceRoot, "exactl-invocations.log");
    const fakeExactl = await writeFakeExactl(workspaceRoot, invocationLog);

    const run = await runSyntheticScenario({
      frameworkHome,
      scenarioPath: "scenarios/swe_tasks/fix-bug-null-guard.yaml",
      workspaceRoot,
      outputDir,
      mode: ScenarioExecutionMode.AUTO,
      // The direct-API cell is reachable anywhere: its binary gate is the always-present `true`.
      selectedCell: "anthropic",
      exactlExecutable: fakeExactl,
      env: { ANTHROPIC_API_KEY: "synthetic-test-key" },
      // Bounds every wait bar, so the run halts at the first file barrier. The judge step is
      // never reached and no provider call is made.
      maxStepTimeoutSec: 2,
    });

    // The cell id is the one the hand-listed form produced: tool + the config's own provider.
    assertEquals(run.manifest.cellId, "exactl-anthropic");
    assertEquals(run.manifest.provider, "anthropic");

    // The preset's default binding forms the cell layer the request step receives.
    const cellOverlay = run.bindingOverlays?.find((overlay) => overlay.role === "cell");
    assertEquals(cellOverlay?.path.endsWith("20-cell.json"), true);
    const invocations = (await Deno.readTextFile(invocationLog)).trim().split("\n");
    const requestLine = invocations.find((line) => line.startsWith("request "));
    assertEquals(requestLine?.includes("20-cell.json"), true, `request step must carry the cell layer: ${requestLine}`);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true }).catch(() => {});
    await Deno.remove(outputDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("[ScenarioFrameworkSyntheticRunner] a bound judge grades the judge step with no provider env", async () => {
  await withSyntheticTestEnv(async ({ frameworkHome, workspaceRoot, outputDir }) => {
    const scenarioPath = await writeSyntheticScenario({
      frameworkHome,
      scenarioId: "synthetic-bound-judge",
      tags: ["synthetic"],
      schemaVersion: SCHEMA_VERSION,
      steps: [{
        // Any step that owns an llm-judge criterion is judge-bearing, whatever its type.
        id: "score-report",
        type: ScenarioStepType.SHELL,
        command: Deno.execPath(),
        args: ["eval", 'console.log("report-ready");'],
        outputCriteriaLines: [
          '    - id: "report-quality"',
          '      kind: "llm-judge"',
          '      preset: "task_fulfillment"',
          "      score_threshold: 0.5",
        ],
      }],
    });

    const run = await runSyntheticScenario({
      frameworkHome,
      scenarioPath,
      workspaceRoot,
      outputDir,
      mode: ScenarioExecutionMode.AUTO,
      // The operator names the judge. No EXA_EVAL_LLM_PROVIDER or EXA_LLM_PROVIDER is set.
      operatorBinds: ["judge:score-report=service=mock,model=mock/mock-model"],
      env: { EXA_EVAL_LLM_MOCK: "false" },
    });

    // The evidence records the judge that graded the step, and where each field came from.
    assertEquals(run.judges?.length, 1);
    const judgeRow = run.judges![0]!;
    assertEquals(judgeRow.stepId, "score-report");
    assertEquals(judgeRow.service, "mock");
    assertEquals(judgeRow.model, "mock/mock-model");
    assertEquals(judgeRow.sources.service?.selector, "judge:score-report");
    assertEquals(judgeRow.judgeSharesSut, false);

    // A skipped criterion would mean no judge was consulted at all.
    const judgeCriterion = run.stepOutcomes
      .flatMap((outcome) => outcome.criterionResults)
      .find((criterion) => criterion.kind === "llm-judge");
    assertEquals(judgeCriterion?.status === CriterionStatus.SKIPPED, false, JSON.stringify(judgeCriterion));
    // With no provider env, only the bound judge can answer. A parse failure, not the provider guard,
    // therefore proves the bound provider was called.
    assertEquals(judgeCriterion?.status, CriterionStatus.ERROR, JSON.stringify(judgeCriterion));
    assertStringIncludes(judgeCriterion?.message ?? "", "failed to parse LLM response");
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
