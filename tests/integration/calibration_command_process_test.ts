/**
 * @module CalibrationCommandProcessTest
 * @path tests/integration/calibration_command_process_test.ts
 * @description Verify profile validation before scenario selection in the real runner process.
 * @architectural-layer Test
 * @dependencies @std/assert, @std/path
 * @related-files [tests/scenario_framework/runner/main.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { loadJudgeProfile } from "../scenario_framework/runner/judge_profile_loader.ts";
import { runSyntheticScenario } from "../scenario_framework/runner/synthetic_runner.ts";
import { CriterionStatus, ScenarioExecutionMode, ScenarioStepType } from "../scenario_framework/schema/step_schema.ts";
import { SCHEMA_VERSION } from "../scenario_framework/schema/version.ts";
import {
  withSyntheticTestEnv,
  writeSyntheticScenario,
} from "../scenario_framework/tests/integration/synthetic_test_helpers.ts";

const RUNNER: string = fromFileUrl(new URL("../scenario_framework/runner/main.ts", import.meta.url));
const PROFILE: string = fromFileUrl(
  new URL("../../packages/core/tests/fixtures/judge_profile/profile.json", import.meta.url),
);

Deno.test("[security] runner rejects an unreadable selected profile before scheduling any scenarios", async (): Promise<void> => {
  const root: string = await Deno.makeTempDir({ prefix: "profile-process-" });
  try {
    const output: Deno.CommandOutput = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-all",
        RUNNER,
        "--judge-profile",
        join(root, "missing.json"),
        "--dry-run",
        "--scenario",
        "missing-scenario",
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 1);
    assertStringIncludes(new TextDecoder().decode(output.stderr), "judge-profile-unreadable");
    assertEquals(new TextDecoder().decode(output.stdout).includes("Running..."), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("selected profile crosses the scenario runner and mock scores remain ineligible", async (): Promise<void> => {
  await withSyntheticTestEnv(async (env): Promise<void> => {
    const scenarioPath: string = await writeSyntheticScenario({
      frameworkHome: env.frameworkHome,
      scenarioId: "profile-wiring",
      tags: ["synthetic"],
      schemaVersion: SCHEMA_VERSION,
      steps: [{
        id: "plan",
        type: ScenarioStepType.SHELL,
        command: Deno.execPath(),
        args: ["eval", 'console.log("Add timeout tests.")'],
        outputCriteriaLines: [
          '    - id: "quality"',
          '      kind: "llm-judge"',
          '      preset: "GOAL_ALIGNED_REVIEW"',
          '      rubric: "Add timeout tests."',
        ],
      }],
    });
    const input = { ...env, scenarioPath, mode: ScenarioExecutionMode.AUTO, env: { EXA_EVAL_LLM_MOCK: "pass" } };
    const ordinary = await runSyntheticScenario(input);
    assertEquals(ordinary.stepOutcomes[0].criterionResults[0].status, CriterionStatus.PASSED);
    const selected = await runSyntheticScenario({ ...input, judgeProfile: await loadJudgeProfile(PROFILE) });
    assertEquals(selected.stepOutcomes[0].criterionResults[0].status, CriterionStatus.SKIPPED);
    assertEquals(selected.stepOutcomes[0].criterionResults[0].score, undefined);
  });
});

Deno.test("[security] profile capture refuses the legacy format before scheduling a paid run", async (): Promise<void> => {
  const output: Deno.CommandOutput = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-all",
      RUNNER,
      "--judge-profile",
      PROFILE,
      "--capture-calibration-evidence",
      "/tmp/unused-profile-capture",
      "--dry-run",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(output.code, 1);
  assertStringIncludes(new TextDecoder().decode(output.stderr), "judge-profile-frozen-capture-required");
  assertEquals(new TextDecoder().decode(output.stdout).includes("Running..."), false);
});
