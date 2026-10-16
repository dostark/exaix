/**
 * @module ScenarioFrameworkTrajectoryEvaluatorTest
 * @path tests/scenario_framework/tests/unit/trajectory_evaluator_test.ts
 * @description Tests for trajectory scoring logic.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/trajectory_evaluator.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { levenshteinTrajectory, scoreTrajectory } from "../../runner/trajectory_evaluator.ts";
import type { IExpectedTrajectory } from "../../runner/trajectory_evaluator.ts";
import type { ITrajectoryResult } from "../../runner/trajectory_evaluator.ts";
import { initTestDbService } from "@exaix/testing";
import { ACTIVITY_EVENT_DYNAMIC_TOOL_CALL } from "@exaix/core";
import { executeScenarioStep } from "../../runner/step_executor.ts";
import { evaluateStepOutcome, StepFailureStage } from "../../runner/assertions.ts";
import { CriterionPhase, ScenarioStepSchema } from "../../schema/step_schema.ts";

function makeObserved(tools: string[]): ITrajectoryResult {
  return {
    matchedCount: 0,
    unmatchedCount: 0,
    extraCount: 0,
    sequence: tools,
  };
}

function makeExpected(overrides: Partial<IExpectedTrajectory>): IExpectedTrajectory {
  return {
    expectedSequence: [],
    orderMatters: true,
    allowExtraTools: false,
    partialCredit: true,
    ...overrides,
  };
}

const EXPECTED_SEQUENCE_SHARED: Array<{ tool: string }> = [
  { tool: "read_file" },
  { tool: "edit_file" },
  { tool: "write_file" },
];

for (const threshold of [undefined, 0.5]) {
  Deno.test(`[TrajectoryEvaluator] a partial score survives execution classification with threshold ${threshold}`, async () => {
    const { db, tempDir, cleanup } = await initTestDbService();
    try {
      db.logActivity("system", ACTIVITY_EVENT_DYNAMIC_TOOL_CALL, "read_file", { tool: "read_file", args: {} }, "trace");
      await db.waitForFlush();
      const step = ScenarioStepSchema.parse({
        id: "partial-trajectory",
        type: "trajectory-assert",
        source_step: "live-flow",
        source_step_rowid_start: 0,
        source_step_rowid_end: 100,
        expected_sequence: [{ tool: "read_file" }, { tool: "list_directory" }],
        order_matters: false,
        partial_credit: true,
        step_pass_threshold: threshold,
      });
      const execution = await executeScenarioStep({ step, cwd: tempDir });
      assertEquals(execution.exitCode, 0, "a mismatched reference is an output failure");
      const outcome = await evaluateStepOutcome({ step, workspaceRoot: tempDir, executionResult: execution });
      assertEquals(outcome.criterionResults[0].score, 0.5);
      assertEquals(outcome.failureStage, threshold === undefined ? CriterionPhase.OUTPUT : null);
      assertEquals(outcome.status, threshold === undefined ? "failed" : "passed");
    } finally {
      await cleanup();
    }
  });
}

Deno.test("[TrajectoryEvaluator] a missing journal remains an execution failure", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "trajectory-missing-" });
  try {
    const step = ScenarioStepSchema.parse({
      id: "missing-journal",
      type: "trajectory-assert",
      source_step: "live-flow",
      expected_sequence: [{ tool: "read_file" }],
      step_pass_threshold: 0,
    });
    const execution = await executeScenarioStep({ step, cwd: workspace });
    const outcome = await evaluateStepOutcome({ step, workspaceRoot: workspace, executionResult: execution });
    assertEquals(execution.exitCode, 1);
    assertEquals(outcome.failureStage, StepFailureStage.EXECUTION);
    assertEquals(outcome.status, "failed");
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
});

Deno.test("[TrajectoryEvaluator] exact match with order_matters=true returns score 1.0", () => {
  const observed = makeObserved(["read_file", "edit_file", "write_file"]);
  const expected = makeExpected({
    expectedSequence: EXPECTED_SEQUENCE_SHARED,
    orderMatters: true,
  });
  const results = scoreTrajectory(observed, expected);
  assertEquals(results[0].status, "passed");
});

Deno.test("[TrajectoryEvaluator] wrong order with order_matters=true returns partial credit", () => {
  const observed = makeObserved(["edit_file", "read_file", "write_file"]);
  const expected = makeExpected({
    expectedSequence: EXPECTED_SEQUENCE_SHARED,
    orderMatters: true,
  });
  const results = scoreTrajectory(observed, expected);
  // Levenshtein distance between [read, edit, write] and [edit, read, write] = 2
  // score = 1 - 2/3 = 0.33 < 1.0
  assertEquals(results[0].status, "failed");
  assertStringIncludes(results[0].message, "0.");
});

Deno.test("[TrajectoryEvaluator] missing tool with order_matters=false returns proportional score", () => {
  const observed = makeObserved(["read_file", "write_file"]);
  const expected = makeExpected({
    expectedSequence: EXPECTED_SEQUENCE_SHARED,
    orderMatters: false,
  });
  const results = scoreTrajectory(observed, expected);
  // 2/3 tools matched → score 0.67 < 1.0
  assertEquals(results[0].status, "failed");
});

Deno.test("[TrajectoryEvaluator] extra tool with allow_extra_tools=true does not fail", () => {
  const observed = makeObserved(["read_file", "edit_file", "write_file", "delete_file"]);
  const expected = makeExpected({
    expectedSequence: [
      { tool: "read_file" },
      { tool: "edit_file" },
      { tool: "write_file" },
    ],
    orderMatters: true,
    allowExtraTools: true,
  });
  const results = scoreTrajectory(observed, expected);
  // With allowExtraTools=true, extra tools don't create a separate failing criterion
  assertEquals(results.length, 1);
  assertEquals(results[0].status, "failed"); // order still matters
});

Deno.test("[TrajectoryEvaluator] extra tool with allow_extra_tools=false adds failing criterion", () => {
  const extraObserved: ITrajectoryResult = {
    matchedCount: 0,
    unmatchedCount: 0,
    extraCount: 2,
    sequence: ["read_file", "edit_file", "delete_file", "archive_file"],
  };
  const expected = makeExpected({
    expectedSequence: [{ tool: "read_file" }, { tool: "edit_file" }],
    allowExtraTools: false,
  });
  const results = scoreTrajectory(extraObserved, expected);
  // Should have both the sequence criterion and the extra-tools criterion
  assertEquals(results.length, 2);
  assertEquals(results[1].criterion_id, "trajectory-extra-tools");
  assertEquals(results[1].status, "failed");
});

Deno.test("[TrajectoryEvaluator] empty expected sequence returns score 1.0", () => {
  const observed = makeObserved([]);
  const expected = makeExpected({
    expectedSequence: [],
    orderMatters: true,
  });
  const results = scoreTrajectory(observed, expected);
  assertEquals(results[0].status, "passed");
});

Deno.test("[TrajectoryEvaluator] all tools in wrong order with order_matters=false scores by multiset", () => {
  const observed = makeObserved(["write_file", "edit_file", "read_file"]);
  const expected = makeExpected({
    expectedSequence: [
      { tool: "read_file" },
      { tool: "edit_file" },
      { tool: "write_file" },
    ],
    orderMatters: false,
  });
  const results = scoreTrajectory(observed, expected);
  // Same tools, different order, order_matters=false → multiset matches all 3
  assertEquals(results[0].status, "passed");
});

Deno.test("[TrajectoryEvaluator] levenshtein distance returns correct values", () => {
  assertEquals(levenshteinTrajectory(["a", "b", "c"], ["a", "b", "c"]), 0);
  assertEquals(levenshteinTrajectory(["a", "b", "c"], ["c", "b", "a"]), 2);
  assertEquals(levenshteinTrajectory([], []), 0);
  assertEquals(levenshteinTrajectory(["a"], []), 1);
});
