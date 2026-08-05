/**
 * @module AblationLiftTest
 * @path tests/scenario_framework/tests/unit/ablation_lift_test.ts
 * @description Phase 143 Step 2 — RED-first unit test for the feature-ablation engine:
 *   `computeAblationContributions` pairs each ablate-<subsystem> cell (control) against
 *   the full-config cell (treatment) on (task, tool, provider, model), latest run wins,
 *   and computes per-subsystem feature contribution via `computePairedComparison` on the
 *   subsystem's `ArmKind` — `meanDelta`/`stdevDelta`/`noEffect` with an explicit basis,
 *   never a bare mean delta. Unmatched tasks, unknown subsystem tokens, and unidentifiable
 *   cells are excluded with a warning count; pre-registration guards the task subset.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/ablation_lift.ts, tests/scenario_framework/runner/arm_comparison.ts]
 */

import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import type { IOutcomeRunRow } from "@exaix/eval-history";
import {
  ArmKind,
  ComparisonMetric,
  type IArmComparisonSpec,
  validatePreregistration,
} from "../../runner/arm_comparison.ts";
import {
  ABLATION_SUBSYSTEM_ARM_KINDS,
  computeAblationContributions,
  parseAblateCellId,
} from "../../runner/ablation_lift.ts";

const MODEL = "claude-sonnet-5";
const FULL_CELL = "claude-code-anthropic";
const ABLATE_SKILLS = "ablate-skills/claude-code/anthropic";
const ABLATE_GATE = "ablate-quality-gate/claude-code/anthropic";
const ABLATE_PK = "ablate-portal-knowledge/claude-code/anthropic";

const T1 = "fix-bug-null-guard";
const T2 = "refactor-utils";
const T3 = "add-feature-x";

function outcomeRow(
  runId: string,
  scenarioId: string,
  cellId: string,
  score: number,
  timestamp: string,
): IOutcomeRunRow {
  return {
    run_id: runId,
    scenario_id: scenarioId,
    pack: "swe_tasks",
    tags: ["task:bug-fix"],
    run_timestamp: timestamp,
    provider: "anthropic",
    model: MODEL,
    cell_id: cellId,
    outcome_scores: [score],
  };
}

function seededRows(): IOutcomeRunRow[] {
  return [
    // T1 treatment: two runs — the later one wins (latest-run-wins on the full side).
    outcomeRow("r-e1", T1, FULL_CELL, 0.8, "2026-08-01T00:00:00.000Z"),
    outcomeRow("r-e1b", T1, FULL_CELL, 0.9, "2026-08-01T00:00:01.000Z"),
    outcomeRow("r-s1", T1, ABLATE_SKILLS, 0.6, "2026-08-01T00:00:00.000Z"),
    outcomeRow("r-g1", T1, ABLATE_GATE, 0.7, "2026-08-01T00:00:00.000Z"),
    outcomeRow("r-p1", T1, ABLATE_PK, 0.85, "2026-08-01T00:00:00.000Z"),
    // T2 matched on all three arms.
    outcomeRow("r-e2", T2, FULL_CELL, 0.9, "2026-08-01T00:00:00.000Z"),
    outcomeRow("r-s2", T2, ABLATE_SKILLS, 0.5, "2026-08-01T00:00:00.000Z"),
    outcomeRow("r-g2", T2, ABLATE_GATE, 0.9, "2026-08-01T00:00:00.000Z"),
    outcomeRow("r-p2", T2, ABLATE_PK, 0.95, "2026-08-01T00:00:00.000Z"),
    // T3: gate control only — no full-config run — unmatched on every arm.
    outcomeRow("r-g3", T3, ABLATE_GATE, 0.8, "2026-08-01T00:00:00.000Z"),
    // Unknown subsystem token — treated as unidentifiable, never silently matched.
    outcomeRow("r-m1", T2, "ablate-memory/claude-code/anthropic", 0.7, "2026-08-01T00:00:00.000Z"),
    // Unparseable cell id — excluded with a warning.
    outcomeRow("r-x1", T1, "unknown", 0.5, "2026-08-01T00:00:00.000Z"),
  ];
}

function skillsSpec(taskIds: string[]): IArmComparisonSpec {
  return {
    armId: "ablate-skills",
    kind: ArmKind.SKILL_ABLATION,
    control: { description: "skills ablation" },
    treatment: { description: "full config" },
    taskIds,
    trials: 1,
    metric: ComparisonMetric.OBJECTIVE_OUTCOME,
    registeredAt: "2026-08-05T00:00:00.000Z",
  };
}

Deno.test("[AblationLift] parseAblateCellId extracts subsystem/tool/provider", () => {
  assertEquals(parseAblateCellId(ABLATE_SKILLS), { subsystem: "skills", tool: "claude-code", provider: "anthropic" });
  assertEquals(parseAblateCellId("ablate-quality-gate/claude-code/anthropic"), {
    subsystem: "quality-gate",
    tool: "claude-code",
    provider: "anthropic",
  });
  assertEquals(parseAblateCellId(null), null);
  assertEquals(parseAblateCellId("bare/claude-code/anthropic"), null);
  assertEquals(parseAblateCellId(FULL_CELL), null);
});

Deno.test("[AblationLift] arm-kind map covers the three shipped subsystems", () => {
  assertEquals(ABLATION_SUBSYSTEM_ARM_KINDS.skills, ArmKind.SKILL_ABLATION);
  assertEquals(ABLATION_SUBSYSTEM_ARM_KINDS["quality-gate"], ArmKind.QUALITY_GATE_ABLATION);
  assertEquals(ABLATION_SUBSYSTEM_ARM_KINDS["portal-knowledge"], ArmKind.PORTAL_KNOWLEDGE_ABLATION);
});

Deno.test("[AblationLift] per-subsystem contribution exact on seeded rows (meanDelta/stdevDelta/noEffect)", () => {
  const report = computeAblationContributions(seededRows());

  assertEquals(report.subsystems.length, 3);
  assertEquals(report.families.length, 3, "one family row per subsystem arm");

  const bySubsystem = new Map(report.families.map((f) => [f.subsystem, f]));
  const skills = bySubsystem.get("skills")!;
  const gate = bySubsystem.get("quality-gate")!;
  const pk = bySubsystem.get("portal-knowledge")!;

  for (const row of [skills, gate, pk]) {
    assertEquals(row.family, "task:bug-fix");
    assertEquals(row.tool, "claude-code");
    assertEquals(row.provider, "anthropic");
    assertEquals(row.model, MODEL);
    assertEquals(row.taskCount, 2);
    assertEquals(row.basis.controlCell, ABLATE_SKILLS.replace("skills", row.subsystem));
    assertEquals(row.basis.treatmentCell, FULL_CELL);
    assertEquals(row.basis.unmatchedTaskIds, [T3], "T3 lacks a full-config run on every arm");
  }

  // Skills: deltas +0.3 (T1, latest treatment run 0.9) and +0.4 (T2) → mean 0.35, stdev 0.05.
  assertAlmostEquals(skills.comparison.meanDelta, 0.35, 1e-9, "skills meanDelta");
  assertAlmostEquals(skills.comparison.stdevDelta, 0.05, 1e-9, "skills stdevDelta");
  assertEquals(skills.comparison.noEffect, false);
  assertEquals(skills.basis.treatmentRunIds, ["r-e1b", "r-e2"], "latest-run-wins on the treatment side");
  assertEquals(skills.basis.controlRunIds, ["r-s1", "r-s2"]);

  // Quality gate: deltas +0.2 (T1) and 0.0 (T2) → mean 0.1, stdev 0.1 — distinguishable.
  assertAlmostEquals(gate.comparison.meanDelta, 0.1, 1e-9, "gate meanDelta");
  assertAlmostEquals(gate.comparison.stdevDelta, 0.1, 1e-9, "gate stdevDelta");
  assertEquals(gate.comparison.noEffect, false);

  // Portal knowledge: deltas +0.05 (T1) and -0.05 (T2) → mean 0, stdev 0.05 → noEffect.
  assertAlmostEquals(pk.comparison.meanDelta, 0, 1e-9, "pk meanDelta");
  assertAlmostEquals(pk.comparison.stdevDelta, 0.05, 1e-9, "pk stdevDelta");
  assertEquals(pk.comparison.noEffect, true);
});

Deno.test("[AblationLift] unmatched and unidentifiable rows are excluded with a warning count", () => {
  const report = computeAblationContributions(seededRows());
  // T3 (no treatment side), the unknown `ablate-memory` token, and the unparseable cell id.
  assertEquals(report.unmatchedWarningCount, 3);
  for (const family of report.families) {
    assertEquals(family.comparison.perTask.length, 2);
  }
});

Deno.test("[AblationLift] preregistration rejects undeclared tasks per subsystem arm", () => {
  const rows = seededRows();
  // Declared task set covers the two matched skills tasks → accepted.
  computeAblationContributions(rows, { preregistered: skillsSpec([T1, T2]) });

  // Undeclared T2 → the skills arm's matched set is not a subset → rejected.
  assertThrows(() => computeAblationContributions(rows, { preregistered: skillsSpec([T1]) }));
});

Deno.test("[AblationLift] empty input yields an empty report", () => {
  const report = computeAblationContributions([]);
  assertEquals(report.families.length, 0);
  assertEquals(report.unmatchedWarningCount, 0);
});

Deno.test("[AblationLift] preregistration validation contract matches the shared engine", () => {
  const spec = skillsSpec([T1, T2]);
  validatePreregistration(spec, { armId: "ablate-skills", metric: ComparisonMetric.OBJECTIVE_OUTCOME, taskIds: [T1] });
  assertThrows(() =>
    validatePreregistration(spec, {
      armId: "ablate-skills",
      metric: ComparisonMetric.OBJECTIVE_OUTCOME,
      taskIds: [T1, T2, "undeclared-task"],
    })
  );
});
