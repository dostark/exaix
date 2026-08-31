/**
 * @module ScenarioFrameworkAblationLift
 * @path tests/scenario_framework/runner/ablation_lift.ts
 * @description Phase 143 Step 2 — the feature-ablation report builder. Matches each
 *   `ablate-<subsystem>/<tool>/<provider>` cell (control) against the full-config cell
 *   (treatment) on (task, tool, provider, model) — latest run set per side — and computes
 *   per-subsystem feature contribution via `computePairedComparison` on the subsystem's
 *   `ArmKind`: meanDelta / stdevDelta / noEffect with an explicit basis, never a bare mean
 *   delta (pre-gap GAP-1: the paired math is the shared Phase 158 engine, and the
 *   bucket/latest-run pairing is reused from the Step 1 lift engine). Outcome-channel only
 *   (Design Decision 1), same as lift. The subsystem → ArmKind map covers the three shipped
 *   factors; an unknown `ablate-` token is treated as unidentifiable and surfaced in the
 *   warning count. Pure computation over `IOutcomeRunRow[]` — no store dependency — shared
 *   by scripts/run_ablation_report.ts and the unit tests.
 * @architectural-layer Test
 * @dependencies [tests/scenario_framework/runner/arm_comparison.ts, tests/scenario_framework/runner/harness_lift.ts]
 * @related-files [scripts/run_ablation_report.ts, apps/exactl/src/commands/eval_commands.ts]
 */

import type { IOutcomeRunRow } from "@exaix/eval-history";
import {
  ArmKind,
  ComparisonMetric,
  computePairedComparison,
  type IArmComparisonSpec,
  type IPairedComparisonResult,
  validatePreregistration,
} from "./arm_comparison.ts";
import {
  type ISideRun,
  keyOf,
  latest,
  mean,
  parseBareCellId,
  parseExaixCellId,
  resolveFamily,
} from "./harness_lift.ts";

/** The basis a contribution comparison is computed on — explicit, never implicit. */
export interface IAblationBasis {
  /** The ablate control cell (`ablate-<subsystem>/<tool>/<provider>`). */
  controlCell: string;
  /** The full-config treatment cell (`<tool>-<provider>`). */
  treatmentCell: string;
  controlRunIds: string[];
  treatmentRunIds: string[];
  /** Tasks of this family that had runs on only one side (or no outcome evidence) and were
   *  therefore excluded from the comparison. */
  unmatchedTaskIds: string[];
}

export interface IAblationFamilyRow {
  family: string;
  tool: string;
  provider: string;
  model: string | null;
  subsystem: string;
  /** Matched task count — the comparison's T. */
  taskCount: number;
  comparison: IPairedComparisonResult;
  basis: IAblationBasis;
}

export interface IAblationReport {
  /** The subsystem arms present in this report, in the shipped-factor order. */
  subsystems: { subsystem: string; kind: ArmKind }[];
  families: IAblationFamilyRow[];
  /** Total count of rows that could not be matched (one side missing, an unknown ablate
   *  subsystem, an unidentifiable cell, or no outcome evidence) — surfaced loudly so a
   *  partial basis is never read as the full picture. */
  unmatchedWarningCount: number;
}

export interface IAblationOptions {
  /** When provided, every subsystem comparison is checked against it before computation —
   *  post-hoc task cherry-picking is rejected (see validatePreregistration).
   *  The spec's `armId` must be the subsystem's `ablate-<subsystem>` arm id. */
  preregistered?: IArmComparisonSpec;
}

/** A (task, tool, provider, model) bucket with one shared treatment and per-subsystem controls. */
interface IAblateBucket {
  taskId: string;
  tool: string;
  provider: string;
  model: string | null;
  family: string;
  controls: Map<string, ISideRun>;
  treatment?: ISideRun;
}

/** The `cell_id` prefix of feature-ablation cells. */
export const ABLATE_CELL_PREFIX = "ablate-";

/** The comparison arm id every contribution comparison of a subsystem uses (pre-registration contract). */
export function ablateArmId(subsystem: string): string {
  return `${ABLATE_CELL_PREFIX}${subsystem}`;
}

/** Map each shipped ablation subsystem to the ArmKind its contribution comparison uses. */
export const ABLATION_SUBSYSTEM_ARM_KINDS: Readonly<Record<string, ArmKind>> = {
  skills: ArmKind.SKILL_ABLATION,
  "quality-gate": ArmKind.QUALITY_GATE_ABLATION,
  "portal-knowledge": ArmKind.PORTAL_KNOWLEDGE_ABLATION,
};

/** Parse an `ablate-<subsystem>/<tool>/<provider>` cell_id, or null for any other shape. */
export function parseAblateCellId(
  cellId: string | null,
): { subsystem: string; tool: string; provider: string } | null {
  if (!cellId || !cellId.startsWith(ABLATE_CELL_PREFIX)) return null;
  const parts = cellId.slice(ABLATE_CELL_PREFIX.length).split("/");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return { subsystem: parts[0], tool: parts[1], provider: parts[2] };
}

// Builds the feature-ablation report from outcome-channel history rows: each task's control/
// treatment score is the mean of the latest ablate-<subsystem>/full-config run's outcome scores.
// A task matches a subsystem only when both sides have a latest run WITH outcome evidence.
export function computeAblationContributions(
  rows: IOutcomeRunRow[],
  options: IAblationOptions = {},
): IAblationReport {
  const buckets = new Map<string, IAblateBucket>();
  let unmatchedWarningCount = 0;

  for (const row of rows) {
    if (row.outcome_scores.length === 0) {
      unmatchedWarningCount++;
      continue;
    }
    const ablate = parseAblateCellId(row.cell_id);
    if (ablate) {
      if (!(ablate.subsystem in ABLATION_SUBSYSTEM_ARM_KINDS)) {
        unmatchedWarningCount++;
        continue;
      }
      const key = keyOf(row.scenario_id, ablate.tool, ablate.provider, row.model);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          taskId: row.scenario_id,
          tool: ablate.tool,
          provider: ablate.provider,
          model: row.model,
          family: resolveFamily(row.tags, row.scenario_id),
          controls: new Map(),
        };
        buckets.set(key, bucket);
      }
      bucket.controls.set(
        ablate.subsystem,
        latest(bucket.controls.get(ablate.subsystem), {
          runId: row.run_id,
          timestamp: row.run_timestamp,
          scores: row.outcome_scores,
        }),
      );
      continue;
    }
    // Treatment side: a full-config cell (never bare, never ablate).
    if (parseBareCellId(row.cell_id)) {
      unmatchedWarningCount++;
      continue;
    }
    const exaix = parseExaixCellId(row.cell_id, row.provider);
    if (!exaix) {
      unmatchedWarningCount++;
      continue;
    }
    const key = keyOf(row.scenario_id, exaix.tool, exaix.provider, row.model);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        taskId: row.scenario_id,
        tool: exaix.tool,
        provider: exaix.provider,
        model: row.model,
        family: resolveFamily(row.tags, row.scenario_id),
        controls: new Map(),
      };
      buckets.set(key, bucket);
    }
    bucket.treatment = latest(bucket.treatment, {
      runId: row.run_id,
      timestamp: row.run_timestamp,
      scores: row.outcome_scores,
    });
  }

  const byFamily = new Map<string, IAblateBucket[]>();
  for (const bucket of buckets.values()) {
    const groupKey = `${bucket.family}|${bucket.tool}|${bucket.provider}|${bucket.model ?? ""}`;
    const group = byFamily.get(groupKey) ?? [];
    group.push(bucket);
    byFamily.set(groupKey, group);
  }

  const subsystems: IAblationReport["subsystems"] = Object.entries(ABLATION_SUBSYSTEM_ARM_KINDS).map(
    ([subsystem, kind]) => ({ subsystem, kind }),
  );
  const families: IAblationFamilyRow[] = [];
  // A bucket counts as unmatched only when it contributed to NO subsystem comparison —
  // partial matches (matched on at least one arm) are used, not lost.
  const usedBucketKeys = new Set<string>();

  for (const group of byFamily.values()) {
    const first = group[0];
    for (const factor of subsystems) {
      const { subsystem } = factor;
      const armId = ablateArmId(subsystem);
      const matched = group.filter((b) => {
        const control = b.controls.get(subsystem);
        return control !== undefined && b.treatment !== undefined;
      });
      const unmatched = group.filter((b) => {
        const control = b.controls.get(subsystem);
        return control === undefined || b.treatment === undefined;
      });

      if (matched.length === 0) continue;

      for (const bucket of matched) {
        usedBucketKeys.add(keyOf(bucket.taskId, bucket.tool, bucket.provider, bucket.model));
      }

      if (options.preregistered && options.preregistered.armId === armId) {
        validatePreregistration(options.preregistered, {
          armId,
          metric: ComparisonMetric.OBJECTIVE_OUTCOME,
          taskIds: matched.map((b) => b.taskId),
        });
      }

      const comparison = computePairedComparison({
        armId,
        metric: ComparisonMetric.OBJECTIVE_OUTCOME,
        tasks: matched.map((b) => ({
          taskId: b.taskId,
          control: [mean(b.controls.get(subsystem)!.scores)],
          treatment: [mean(b.treatment!.scores)],
        })),
      });

      families.push({
        family: first.family,
        tool: first.tool,
        provider: first.provider,
        model: first.model,
        subsystem,
        taskCount: matched.length,
        comparison,
        basis: {
          controlCell: `${ABLATE_CELL_PREFIX}${subsystem}/${first.tool}/${first.provider}`,
          treatmentCell: `${first.tool}-${first.provider}`,
          controlRunIds: matched.map((b) => b.controls.get(subsystem)!.runId),
          treatmentRunIds: matched.map((b) => b.treatment!.runId),
          unmatchedTaskIds: unmatched.map((b) => b.taskId),
        },
      });
    }
  }

  for (const group of byFamily.values()) {
    for (const bucket of group) {
      if (!usedBucketKeys.has(keyOf(bucket.taskId, bucket.tool, bucket.provider, bucket.model))) {
        unmatchedWarningCount++;
      }
    }
  }

  return { subsystems, families, unmatchedWarningCount };
}
