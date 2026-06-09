/**
 * @module ScenarioFrameworkTrajectoryEvaluatorTest
 * @path tests/scenario_framework/tests/unit/trajectory_evaluator_test.ts
 * @description Tests for trajectory scoring logic.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/trajectory_evaluator.ts]
 */

import { assertEquals } from "@std/assert";
import { levenshteinTrajectory, scoreTrajectory } from "../../runner/trajectory_evaluator.ts";
import type { IExpectedTrajectory } from "../../runner/trajectory_evaluator.ts";
import type { ITrajectoryResult } from "../../runner/trajectory_evaluator.ts";

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

Deno.test("[TrajectoryEvaluator] exact match with order_matters=true returns score 1.0", () => {
  const observed = makeObserved(["read_file", "edit_file", "write_file"]);
  const expected = makeExpected({
    expectedSequence: [
      { tool: "read_file" },
      { tool: "edit_file" },
      { tool: "write_file" },
    ],
    orderMatters: true,
  });
  const results = scoreTrajectory(observed, expected);
  assertEquals(results[0].status, "passed");
});

Deno.test("[TrajectoryEvaluator] wrong order with order_matters=true returns partial credit", () => {
  const observed = makeObserved(["edit_file", "read_file", "write_file"]);
  const expected = makeExpected({
    expectedSequence: [
      { tool: "read_file" },
      { tool: "edit_file" },
      { tool: "write_file" },
    ],
    orderMatters: true,
  });
  const results = scoreTrajectory(observed, expected);
  // Levenshtein distance between [read, edit, write] and [edit, read, write] = 2
  // score = 1 - 2/3 = 0.33 < 1.0
  assertEquals(results[0].status, "failed");
  assertEquals(results[0].message.includes("0."), true);
});

Deno.test("[TrajectoryEvaluator] missing tool with order_matters=false returns proportional score", () => {
  const observed = makeObserved(["read_file", "write_file"]);
  const expected = makeExpected({
    expectedSequence: [
      { tool: "read_file" },
      { tool: "edit_file" },
      { tool: "write_file" },
    ],
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
  const observed = makeObserved(["read_file", "edit_file"]);
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
