/**
 * @module ScenarioFrameworkPairedDeltaTest
 * @path tests/scenario_framework/tests/unit/paired_delta_test.ts
 * @description Tests for paired arm-comparison delta computation (Phase 158 Step 1).
 * A comparison is a set of tasks, each run under a control and a treatment arm for
 * k trials; the per-task delta is treatment mean minus control mean, and the
 * aggregate reports the mean delta, its standard deviation across tasks, and how
 * many tasks disagree in sign with the aggregate.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/arm_comparison.ts, tests/scenario_framework/runner/evidence_collector.ts]
 */

import { assertEquals } from "@std/assert";
import { computePairedComparison } from "../../runner/arm_comparison.ts";
import { ArmKind, ComparisonMetric } from "../../runner/arm_comparison.ts";
import type { IArmComparisonSpec } from "../../runner/arm_comparison.ts";
import { writeRunManifest } from "../../runner/evidence_collector.ts";
import type { IRunManifest } from "../../runner/evidence_collector.ts";

Deno.test("[PairedDelta] a single task with a known delta produces that delta", () => {
  const result = computePairedComparison({
    armId: "skill-tdd-methodology",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.5, 0.5, 0.5], treatment: [0.8, 0.8, 0.8] },
    ],
  });

  assertEquals(result.perTask.length, 1);
  assertEquals(Math.round(result.perTask[0].delta * 100) / 100, 0.3);
  assertEquals(Math.round(result.meanDelta * 100) / 100, 0.3);
});

Deno.test("[PairedDelta] two tasks average to the mean of their per-task deltas", () => {
  const result = computePairedComparison({
    armId: "skill-tdd-methodology",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.5], treatment: [0.7] }, // delta 0.2
      { taskId: "task-2", control: [0.5], treatment: [0.6] }, // delta 0.1
    ],
  });

  assertEquals(result.perTask[0].delta, 0.7 - 0.5);
  assertEquals(result.perTask[1].delta, 0.6 - 0.5);
  assertEquals(Math.round(result.meanDelta * 1000) / 1000, 0.15);
});

Deno.test("[PairedDelta] sign-disagreement counts tasks whose delta sign opposes the aggregate", () => {
  const result = computePairedComparison({
    armId: "skill-tdd-methodology",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.5], treatment: [0.9] }, // +0.4, agrees
      { taskId: "task-2", control: [0.5], treatment: [0.9] }, // +0.4, agrees
      { taskId: "task-3", control: [0.5], treatment: [0.2] }, // -0.3, disagrees
    ],
  });

  // aggregate mean delta is positive ((0.4 + 0.4 - 0.3) / 3 = 0.1667), so task-3 disagrees
  assertEquals(result.signDisagreementCount, 1);
});

Deno.test("[PairedDelta] a zero-delta task neither agrees nor disagrees with the aggregate", () => {
  const result = computePairedComparison({
    armId: "skill-tdd-methodology",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.5], treatment: [0.9] }, // +0.4, agrees
      { taskId: "task-2", control: [0.5], treatment: [0.5] }, // 0, neutral
    ],
  });

  assertEquals(result.signDisagreementCount, 0);
});

Deno.test("[PairedDelta] within-arm trial variance is computed via computeMultiTrialMetrics, not re-derived", () => {
  const result = computePairedComparison({
    armId: "skill-tdd-methodology",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.4, 0.5, 0.6], treatment: [0.7, 0.8, 0.9] },
    ],
  });

  assertEquals(result.perTask[0].controlMetrics.mean, 0.5);
  assertEquals(Math.round(result.perTask[0].treatmentMetrics.mean * 10) / 10, 0.8);
  // stdev of [0.4,0.5,0.6] population stdev
  assertEquals(Math.round(result.perTask[0].controlMetrics.stdev * 1000) / 1000, 0.082);
});

Deno.test("[PairedDelta] the arm comparison spec is persisted in the run manifest and round-trips faithfully", async () => {
  const spec: IArmComparisonSpec = {
    armId: "skill-tdd-methodology",
    kind: ArmKind.SKILL_ABLATION,
    control: { description: "resolved set minus tdd-methodology" },
    treatment: { description: "resolved set as normal" },
    taskIds: ["task-1", "task-2"],
    trials: 3,
    metric: ComparisonMetric.JUDGE_SCORE,
    registeredAt: "2026-08-02T00:00:00.000Z",
  };
  const manifest: IRunManifest = {
    scenarioId: "skill-tdd-methodology-value",
    pack: "artefact_value",
    mode: "live",
    outcome: "success",
    steps: [],
    armComparison: spec,
  };

  const tempDir = await Deno.makeTempDir();
  try {
    const manifestPath = await writeRunManifest({ outputDir: tempDir, manifest });
    const written = JSON.parse(await Deno.readTextFile(manifestPath)) as IRunManifest;
    assertEquals(written.armComparison, spec);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
