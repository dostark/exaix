/**
 * @module CommandOutputStreamsTest
 * @path tests/scenario_framework/tests/unit/command_output_streams_test.ts
 * @description Pins that the command-output criteria read stdout and stderr together, so moving the exactl display lines to stderr cannot break a text criterion.
 * @architectural-layer Test
 * @dependencies [@std/assert, tests/scenario_framework/runner/assertions.ts]
 * @related-files [tests/scenario_framework/runner/assertions.ts, tests/scenario_framework/runner/step_executor.ts]
 */

import { assertEquals } from "@std/assert";
import { evaluateCriterion } from "../../runner/assertions.ts";
import { CriterionKind, CriterionPhase, CriterionStatus, ScenarioStepType } from "../../schema/step_schema.ts";
import type { IScenarioStepExecutionResult } from "../../runner/step_executor.ts";

const DISPLAY_LINE = "daemon.started";

function executionResult(stdout: string, stderr: string): IScenarioStepExecutionResult {
  return {
    stepId: "s1",
    stepType: ScenarioStepType.EXACTL,
    startedAt: "2026-11-14T00:00:00.000Z",
    completedAt: "2026-11-14T00:00:01.000Z",
    durationMs: 1000,
    exitCode: 0,
    stdout,
    stderr,
    combinedOutput: stdout + stderr,
  };
}

Deno.test("command-output-contains finds text that only stderr carries", async () => {
  const result = await evaluateCriterion({
    workspaceRoot: ".",
    phase: CriterionPhase.OUTPUT,
    criterion: { id: "display", kind: CriterionKind.COMMAND_OUTPUT_CONTAINS, contains: [DISPLAY_LINE] },
    executionResult: executionResult("[]\n", `✅ ${DISPLAY_LINE}: daemon\n`),
  });
  assertEquals(result.status, CriterionStatus.PASSED);
});

Deno.test("command-output-contains still fails when neither stream carries the text", async () => {
  const result = await evaluateCriterion({
    workspaceRoot: ".",
    phase: CriterionPhase.OUTPUT,
    criterion: { id: "display", kind: CriterionKind.COMMAND_OUTPUT_CONTAINS, contains: [DISPLAY_LINE] },
    executionResult: executionResult("[]\n", ""),
  });
  assertEquals(result.status, CriterionStatus.FAILED);
});
