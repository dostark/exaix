/**
 * @module ScenarioFrameworkAgentRoleTaskTypeReportTest
 * @path tests/scenario_framework/tests/unit/agent_role_task_type_report_test.ts
 * @description Tests for Phase 158 Step 5's per-task-type delta grouping: an agent role
 * may win on one task type (e.g. bugfix) and lose on another (e.g. refactor), so the
 * report groups Step 1's already-computed per-task deltas by task type rather than
 * collapsing them into one aggregate, which would hide exactly that disagreement.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/agent_role_task_type_report.ts, tests/scenario_framework/runner/arm_comparison.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { groupDeltasByTaskType } from "../../runner/agent_role_task_type_report.ts";
import { computePairedComparison } from "../../runner/arm_comparison.ts";
import { ComparisonMetric } from "../../runner/arm_comparison.ts";

Deno.test("[AgentRoleTaskTypeReport] deltas are grouped into their declared task type", () => {
  const result = computePairedComparison({
    armId: "agent-role-swap-a-vs-b",
    metric: ComparisonMetric.OBJECTIVE_OUTCOME,
    tasks: [
      { taskId: "task-bugfix-1", control: [0.5], treatment: [0.9] }, // +0.4
      { taskId: "task-refactor-1", control: [0.5], treatment: [0.2] }, // -0.3
    ],
  });

  const groups = groupDeltasByTaskType(result.perTask, {
    "task-bugfix-1": "bugfix",
    "task-refactor-1": "refactor",
  });

  const bugfix = groups.find((g) => g.taskType === "bugfix");
  const refactor = groups.find((g) => g.taskType === "refactor");
  assertEquals(Math.round((bugfix?.meanDelta ?? 0) * 100) / 100, 0.4);
  assertEquals(Math.round((refactor?.meanDelta ?? 0) * 100) / 100, -0.3);
});

Deno.test("[AgentRoleTaskTypeReport] an agent role that wins on one type and loses on another produces opposite-signed groups", () => {
  const result = computePairedComparison({
    armId: "agent-role-swap-a-vs-b",
    metric: ComparisonMetric.OBJECTIVE_OUTCOME,
    tasks: [
      { taskId: "bugfix-1", control: [0.5], treatment: [0.9] },
      { taskId: "bugfix-2", control: [0.5], treatment: [0.8] },
      { taskId: "refactor-1", control: [0.5], treatment: [0.1] },
      { taskId: "refactor-2", control: [0.5], treatment: [0.2] },
    ],
  });

  const groups = groupDeltasByTaskType(result.perTask, {
    "bugfix-1": "bugfix",
    "bugfix-2": "bugfix",
    "refactor-1": "refactor",
    "refactor-2": "refactor",
  });

  const bugfix = groups.find((g) => g.taskType === "bugfix");
  const refactor = groups.find((g) => g.taskType === "refactor");
  assertEquals((bugfix?.meanDelta ?? 0) > 0, true);
  assertEquals((refactor?.meanDelta ?? 0) < 0, true);
});

Deno.test("[AgentRoleTaskTypeReport] a group's task ids are preserved for traceability", () => {
  const result = computePairedComparison({
    armId: "agent-role-swap-a-vs-b",
    metric: ComparisonMetric.OBJECTIVE_OUTCOME,
    tasks: [{ taskId: "bugfix-1", control: [0.5], treatment: [0.9] }],
  });
  const groups = groupDeltasByTaskType(result.perTask, { "bugfix-1": "bugfix" });
  assertEquals(groups[0].taskIds, ["bugfix-1"]);
});

Deno.test("[AgentRoleTaskTypeReport] a task with no declared type throws, naming the task", () => {
  const result = computePairedComparison({
    armId: "agent-role-swap-a-vs-b",
    metric: ComparisonMetric.OBJECTIVE_OUTCOME,
    tasks: [{ taskId: "untyped-task", control: [0.5], treatment: [0.9] }],
  });
  assertThrows(() => groupDeltasByTaskType(result.perTask, {}), Error, "untyped-task");
});

Deno.test("[AgentRoleTaskTypeReport] a group's noEffect flag applies the same rule as the aggregate: |mean| < stdev", () => {
  const result = computePairedComparison({
    armId: "agent-role-swap-a-vs-b",
    metric: ComparisonMetric.OBJECTIVE_OUTCOME,
    tasks: [
      { taskId: "bugfix-1", control: [0.5], treatment: [0.4] }, // -0.1
      { taskId: "bugfix-2", control: [0.5], treatment: [0.6] }, // +0.1
    ],
  });
  const groups = groupDeltasByTaskType(result.perTask, { "bugfix-1": "bugfix", "bugfix-2": "bugfix" });
  assertEquals(groups[0].noEffect, true);
});
