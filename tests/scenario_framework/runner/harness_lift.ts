/**
 * @module ScenarioFrameworkHarnessLift
 * @path tests/scenario_framework/runner/harness_lift.ts
 * @description Phase 143 Step 1 — the harness-lift report builder. Matches Exaix-cell runs
 * (treatment) against bare-delegate baseline runs (control) from eval history on
 * (task, tool, provider, model) — latest run set per cell — and computes the per-family paired
 * lift via `computePairedComparison` on `ArmKind.HARNESS_ABLATION`: meanDelta / stdevDelta /
 * noEffect with an explicit basis (cells, run ids, task count), never a bare point delta.
 * Outcome-channel only (Design Decision 1): the input builder passes the outcome step scores
 * (verify-tests) and nothing else, so process-channel criteria that only Exaix runs could
 * satisfy are excluded from both sides. Pre-gap GAP-1: the paired-delta math is reused from
 * arm_comparison.ts, never reimplemented. Pure computation over `IOutcomeRunRow[]` — no store
 * dependency — shared by scripts/run_harness_lift_report.ts and the unit tests.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/arm_comparison.ts, packages/eval-history/src/history_sqlite.ts, scripts/run_harness_lift_report.ts]
 */

import {
  ArmKind,
  ComparisonMetric,
  computePairedComparison,
  type IArmComparisonSpec,
  type IPairedComparisonResult,
  validatePreregistration,
} from "./arm_comparison.ts";
import type { IOutcomeRunRow } from "@exaix/eval-history";
import type { Opt, Reason } from "@exaix/core/types";

/** The basis a family comparison is computed on — explicit, never implicit. */
export interface IHarnessLiftBasis {
  /** The bare control cell (`bare/<tool>/<provider>`). */
  controlCell: string;
  /** The Exaix treatment cell (`<tool>-<provider>`). */
  treatmentCell: string;
  controlRunIds: string[];
  treatmentRunIds: string[];
  /** Tasks of this family that had runs on only one side (or no outcome evidence) and were
   *  therefore excluded from the comparison. */
  unmatchedTaskIds: string[];
}

export interface IHarnessLiftFamily {
  family: string;
  tool: string;
  provider: string;
  model: string | null;
  /** Matched task count — the comparison's T. */
  taskCount: number;
  comparison: IPairedComparisonResult;
  basis: IHarnessLiftBasis;
}

export interface IHarnessLiftReport {
  arm: { kind: ArmKind; metric: ComparisonMetric };
  families: IHarnessLiftFamily[];
  /** Total count of tasks that could not be paired (one side missing, no outcome evidence,
   *  or an unidentifiable cell) — surfaced loudly so a partial basis is never read as the
   *  full picture. */
  unmatchedWarningCount: number;
}

export interface IHarnessLiftOptions {
  /** When provided, every family comparison is checked against it before computation —
   *  post-hoc task cherry-picking is rejected (pre-gap GAP-1 / validatePreregistration). */
  preregistered?: IArmComparisonSpec;
}

/** A single side's latest outcome run (shared by the lift and ablation engines). */
export interface ISideRun {
  runId: string;
  timestamp: string;
  scores: number[];
}

/** The `cell_id` prefix of bare-delegate baseline cells (Phase 143 Step 1 cell taxonomy). */
export const BARE_CELL_PREFIX = "bare/";

/** The comparison arm id every harness-lift comparison uses (pre-registration contract). */
export const HARNESS_LIFT_ARM_ID = "harness-lift";

/** The tag-prefix convention that marks a run's task family (mirrors `summarizeByTag`). */
const FAMILY_TAG_PREFIX = "task:";

/** Parse a `bare/<tool>/<provider>` cell_id into its (tool, provider) pair, or null. */
export function parseBareCellId(cellId: string | null): { tool: string; provider: string } | null {
  if (!cellId || !cellId.startsWith(BARE_CELL_PREFIX)) return null;
  const parts = cellId.slice(BARE_CELL_PREFIX.length).split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { tool: parts[0], provider: parts[1] };
}

/**
 * Parse an Exaix cell_id into its (tool, provider) pair. The runner records
 * `<tool>-<provider>`, and BOTH names may contain dashes ("claude-code", "claude-cli"), so the
 * split is only reliable with the row's explicit `provider` column as a suffix hint: the tool
 * is the cell_id minus its trailing `-<provider>`. A last-dash fallback (provider without
 * dashes) keeps legacy rows pairing.
 */
export function parseExaixCellId(
  cellId: string | null,
  providerHint: string | null,
): { tool: string; provider: string } | null {
  if (!cellId || cellId.startsWith(BARE_CELL_PREFIX)) return null;
  if (providerHint && cellId.length > providerHint.length + 1 && cellId.endsWith(`-${providerHint}`)) {
    const tool = cellId.slice(0, cellId.length - providerHint.length - 1);
    if (tool) return { tool, provider: providerHint };
  }
  const dashIndex = cellId.lastIndexOf("-");
  if (dashIndex > 0 && dashIndex < cellId.length - 1) {
    return { tool: cellId.slice(0, dashIndex), provider: cellId.slice(dashIndex + 1) };
  }
  const slashIndex = cellId.lastIndexOf("/");
  if (slashIndex > 0 && slashIndex < cellId.length - 1) {
    return { tool: cellId.slice(0, slashIndex), provider: cellId.slice(slashIndex + 1) };
  }
  return null;
}

/** The task family of a run: its first `task:` tag, falling back to the task id. */
export function resolveFamily(tags: string[] | null, fallback: string): string {
  if (tags) {
    for (const tag of tags) {
      if (tag.startsWith(FAMILY_TAG_PREFIX) && tag.length > FAMILY_TAG_PREFIX.length) return tag;
    }
  }
  return fallback;
}

/**
 * The pairing identity of a run's TASK — what the lift/ablation views pair on. A bare cell
 * running `bare-swe-<task>` IS the same task as the Exaix cell's `swe-<task>` — the `bare-`
 * prefix is a rendering artifact and is stripped so the pair matches. (The `task:` tag is a
 * FAMILY grouping, never a per-task id, so it does not participate in pairing.)
 */
export function resolveTaskIdentity(row: IOutcomeRunRow): string {
  const bare = row.cell_id?.startsWith(BARE_CELL_PREFIX) ?? false;
  if (bare && row.scenario_id.startsWith("bare-") && row.scenario_id.length > "bare-".length) {
    return row.scenario_id.slice("bare-".length);
  }
  return row.scenario_id;
}

/** Bucket key over (task, tool, provider, model) — the lift and ablation pairing unit. */
export function keyOf(taskId: string, tool: string, provider: string, model: string | null): string {
  return `${taskId}|${tool}|${provider}|${model ?? ""}`;
}

/** Latest-run-wins accumulation over ISO-8601 timestamps (lexicographic sort). */
export function latest(existing: Opt<ISideRun, Reason.RecursiveOmit>, candidate: ISideRun): ISideRun {
  if (!existing) return candidate;
  // ISO-8601 timestamps sort lexicographically; later wins.
  return candidate.timestamp > existing.timestamp ? candidate : existing;
}

/** Arithmetic mean over a numeric list. */
export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** A (task, tool, provider, model) bucket pairing one latest run per side. */
interface IMatchBucket {
  taskId: string;
  tool: string;
  provider: string;
  model: string | null;
  family: string;
  control?: ISideRun;
  treatment?: ISideRun;
  /** True when the task had runs but both sides lack a latest run with outcome evidence. */
  unmatched: boolean;
}

/**
 * Build the harness-lift report from outcome-channel history rows. Each task's control score is
 * the mean of the latest bare run's outcome scores; treatment likewise from the latest Exaix
 * run. A task matches only when both sides have a latest run WITH outcome evidence — anything
 * less is excluded and counted. Families group on the `task:` tag (fallback: task id) within a
 * (tool, provider, model) column.
 */
export function computeHarnessLift(
  rows: IOutcomeRunRow[],
  options: IHarnessLiftOptions = {},
): IHarnessLiftReport {
  const buckets = new Map<string, IMatchBucket>();
  const unidentifiableTaskIds = new Set<string>();

  for (const row of rows) {
    const bare = parseBareCellId(row.cell_id);
    const exaix = bare ? null : parseExaixCellId(row.cell_id, row.provider);
    const identity = bare ?? exaix;
    if (!identity) {
      unidentifiableTaskIds.add(row.scenario_id);
      continue;
    }
    if (row.outcome_scores.length === 0) continue;

    const taskId = resolveTaskIdentity(row);
    const key = keyOf(taskId, identity.tool, identity.provider, row.model);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        taskId,
        tool: identity.tool,
        provider: identity.provider,
        model: row.model,
        family: resolveFamily(row.tags, taskId),
        unmatched: true,
      };
      buckets.set(key, bucket);
    }
    const side: ISideRun = {
      runId: row.run_id,
      timestamp: row.run_timestamp,
      scores: row.outcome_scores,
    };
    if (bare) bucket.control = latest(bucket.control, side);
    else bucket.treatment = latest(bucket.treatment, side);
  }

  const byFamily = new Map<string, IMatchBucket[]>();
  for (const bucket of buckets.values()) {
    const matched = bucket.control !== undefined && bucket.treatment !== undefined;
    bucket.unmatched = !matched;
    const groupKey = `${bucket.family}|${bucket.tool}|${bucket.provider}|${bucket.model ?? ""}`;
    const group = byFamily.get(groupKey) ?? [];
    group.push(bucket);
    byFamily.set(groupKey, group);
  }

  const families: IHarnessLiftFamily[] = [];
  let unmatchedWarningCount = unidentifiableTaskIds.size;

  for (const group of byFamily.values()) {
    const first = group[0];
    const matched = group.filter((b) => !b.unmatched);
    const unmatched = group.filter((b) => b.unmatched);
    unmatchedWarningCount += unmatched.length;

    if (matched.length > 0 && options.preregistered) {
      validatePreregistration(options.preregistered, {
        armId: HARNESS_LIFT_ARM_ID,
        metric: ComparisonMetric.OBJECTIVE_OUTCOME,
        taskIds: matched.map((b) => b.taskId),
      });
    }

    const comparison = computePairedComparison({
      armId: HARNESS_LIFT_ARM_ID,
      metric: ComparisonMetric.OBJECTIVE_OUTCOME,
      tasks: matched.map((b) => ({
        taskId: b.taskId,
        control: [mean(b.control!.scores)],
        treatment: [mean(b.treatment!.scores)],
      })),
    });

    const familiesWithTasks = matched.length > 0
      ? [{
        family: first.family,
        tool: first.tool,
        provider: first.provider,
        model: first.model,
        taskCount: matched.length,
        comparison,
        basis: {
          controlCell: `${BARE_CELL_PREFIX}${first.tool}/${first.provider}`,
          treatmentCell: `${first.tool}-${first.provider}`,
          controlRunIds: matched.map((b) => b.control!.runId),
          treatmentRunIds: matched.map((b) => b.treatment!.runId),
          unmatchedTaskIds: unmatched.map((b) => b.taskId),
        },
      }]
      : [];

    families.push(...familiesWithTasks);
  }

  return {
    arm: { kind: ArmKind.HARNESS_ABLATION, metric: ComparisonMetric.OBJECTIVE_OUTCOME },
    families,
    unmatchedWarningCount,
  };
}
