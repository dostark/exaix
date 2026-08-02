/**
 * @module ScenarioFrameworkPreregistrationTest
 * @path tests/scenario_framework/tests/unit/preregistration_test.ts
 * @description Tests for pre-registration enforcement (Phase 158 Step 1, Design
 * Decision 1): a comparison's task set and metric must be declared before any
 * trial runs. Choosing tasks or metrics after seeing results is the most likely
 * way this phase produces confident nonsense, so the harness rejects a run whose
 * metric or task set was not declared in advance rather than trusting the reader
 * to notice.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/arm_comparison.ts]
 */

import { assertThrows } from "@std/assert";
import { ArmKind, ComparisonMetric, validatePreregistration } from "../../runner/arm_comparison.ts";
import type { IArmComparisonSpec } from "../../runner/arm_comparison.ts";

function makeSpec(overrides: Partial<IArmComparisonSpec> = {}): IArmComparisonSpec {
  return {
    armId: "skill-tdd-methodology",
    kind: ArmKind.SKILL_ABLATION,
    control: { description: "resolved set minus tdd-methodology" },
    treatment: { description: "resolved set as normal" },
    taskIds: ["task-1", "task-2"],
    trials: 3,
    metric: ComparisonMetric.JUDGE_SCORE,
    registeredAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

Deno.test("[Preregistration] a matching arm, metric and task set passes validation without throwing", () => {
  const spec = makeSpec();
  validatePreregistration(spec, {
    armId: "skill-tdd-methodology",
    metric: ComparisonMetric.JUDGE_SCORE,
    taskIds: ["task-1", "task-2"],
  });
});

Deno.test("[Preregistration] a metric not declared before execution is rejected", () => {
  const spec = makeSpec({ metric: ComparisonMetric.JUDGE_SCORE });
  assertThrows(
    () =>
      validatePreregistration(spec, {
        armId: "skill-tdd-methodology",
        metric: ComparisonMetric.OBJECTIVE_OUTCOME,
        taskIds: ["task-1", "task-2"],
      }),
    Error,
    "metric",
  );
});

Deno.test("[Preregistration] a task not in the declared task set is rejected", () => {
  const spec = makeSpec({ taskIds: ["task-1", "task-2"] });
  assertThrows(
    () =>
      validatePreregistration(spec, {
        armId: "skill-tdd-methodology",
        metric: ComparisonMetric.JUDGE_SCORE,
        taskIds: ["task-1", "task-2", "task-3"],
      }),
    Error,
    "task",
  );
});

Deno.test("[Preregistration] an arm id mismatch is rejected", () => {
  const spec = makeSpec({ armId: "skill-tdd-methodology" });
  assertThrows(
    () =>
      validatePreregistration(spec, {
        armId: "skill-fix-bug",
        metric: ComparisonMetric.JUDGE_SCORE,
        taskIds: ["task-1", "task-2"],
      }),
    Error,
    "arm",
  );
});

Deno.test("[Preregistration] running a subset of the declared task set is allowed (screening passes)", () => {
  const spec = makeSpec({ taskIds: ["task-1", "task-2", "task-3"] });
  // Screening passes (Design Decision 4) run a task subset — validation only rejects
  // tasks NOT in the declared set, not a run that declines to use every declared task.
  validatePreregistration(spec, {
    armId: "skill-tdd-methodology",
    metric: ComparisonMetric.JUDGE_SCORE,
    taskIds: ["task-1"],
  });
});

Deno.test("[Preregistration] error message names the offending arm so a rejected run is diagnosable", () => {
  const spec = makeSpec({ armId: "skill-tdd-methodology" });
  assertThrows(
    () =>
      validatePreregistration(spec, {
        armId: "skill-tdd-methodology",
        metric: ComparisonMetric.OBJECTIVE_OUTCOME,
        taskIds: ["task-1", "task-2"],
      }),
    Error,
    "skill-tdd-methodology",
  );
});
