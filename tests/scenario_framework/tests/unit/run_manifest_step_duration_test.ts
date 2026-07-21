// deno-lint-ignore-file no-explicit-any
/**
 * @module RunManifestStepDurationTest
 * @path tests/scenario_framework/tests/unit/run_manifest_step_duration_test.ts
 * @description Phase 140a Step 1 — RED-first tests. The runner already computes a real
 * wall-clock durationMs per step (step_executor.ts), but buildRunManifest discards it and
 * IRunManifestStep has no field to receive it. Verifies durationMs is carried into the
 * manifest, survives an undefined executionResult without throwing, and round-trips into
 * both the JSONL history entry and the eval_run_steps SQLite column via the real main.ts
 * call chain (not a direct EvalSqliteStore.writeRun() call bypassing that projection).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts, tests/scenario_framework/runner/evidence_collector.ts, tests/scenario_framework/runner/history_writer.ts, tests/scenario_framework/runner/main.ts]
 */

import { assertEquals } from "@std/assert";
import { buildRunManifest } from "../../runner/synthetic_runner.ts";
import { CriterionStatus, ScenarioStepType } from "../../schema/step_schema.ts";
import type { IScenarioStepOutcome } from "../../runner/assertions.ts";

function makeLoadedScenario(id: string, stepIds: string[]) {
  return {
    scenario: { id, pack: "swe_tasks", title: "test", steps: [], portals: [], request_fixture: "", mode_support: [] },
    steps: stepIds.map((stepId) => ({
      id: stepId,
      type: ScenarioStepType.SHELL,
      continue_on_failure: false,
      input_criteria: [],
      output_criteria: [],
    })),
    requestFixture: { id: "req", title: "test", body: "test" },
    absoluteScenarioPath: "/tmp/test.yaml",
  } as any;
}

function makeStepOutcome(
  stepId: string,
  durationMs: number | undefined,
): IScenarioStepOutcome {
  return {
    stepId,
    status: CriterionStatus.PASSED,
    failureStage: null,
    criterionResults: [],
    executionResult: durationMs === undefined ? undefined : {
      stepId,
      stepType: ScenarioStepType.SHELL,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs,
      exitCode: 0,
      stdout: "",
      stderr: "",
      combinedOutput: "",
    },
  };
}

Deno.test({
  name:
    "[RunManifestStepDuration] buildRunManifest carries the runner's own computed durationMs onto the manifest step",
  fn: () => {
    const manifest = buildRunManifest({
      loadedScenario: makeLoadedScenario("duration-test", ["step-1"]),
      stepOutcomes: [makeStepOutcome("step-1", 4242)],
      runResult: { scenarioFailed: false, stepOutcomes: [], executionError: null },
      mode: "auto",
    } as any);

    assertEquals(manifest.steps[0].durationMs, 4242);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "[RunManifestStepDuration] a step outcome with no executionResult produces durationMs: undefined, not a thrown error",
  fn: () => {
    const manifest = buildRunManifest({
      loadedScenario: makeLoadedScenario("no-exec-result", ["step-1"]),
      stepOutcomes: [makeStepOutcome("step-1", undefined)],
      runResult: { scenarioFailed: false, stepOutcomes: [], executionError: null },
      mode: "auto",
    } as any);

    assertEquals(manifest.steps[0].durationMs, undefined);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[RunManifestStepDuration] multiple steps each carry their own independent durationMs",
  fn: () => {
    const manifest = buildRunManifest({
      loadedScenario: makeLoadedScenario("multi-step", ["step-1", "step-2"]),
      stepOutcomes: [makeStepOutcome("step-1", 100), makeStepOutcome("step-2", 200)],
      runResult: { scenarioFailed: false, stepOutcomes: [], executionError: null },
      mode: "auto",
    } as any);

    assertEquals(manifest.steps[0].durationMs, 100);
    assertEquals(manifest.steps[1].durationMs, 200);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
