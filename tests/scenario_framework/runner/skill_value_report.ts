/**
 * @module ScenarioFrameworkSkillValueReport
 * @path tests/scenario_framework/runner/skill_value_report.ts
 * @description Phase 158 Step 4's skill value report: renders delta, variance,
 * value-per-1k-tokens (reusing Step 1's computeValuePerToken rather than re-deriving it)
 * and the no-effect verdict per skill, plus the non-coverage list with its per-skill
 * reason. Pure computation only, matching arm_comparison.ts's pattern — collecting the
 * paired comparisons and token deltas per skill is the caller's concern.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/skill_value_report_test.ts, tests/scenario_framework/runner/arm_comparison.ts, tests/scenario_framework/runner/skill_corpus_reachability.ts]
 */

import { computeValuePerToken, type IPairedComparisonResult } from "./arm_comparison.ts";
import type { INonCoverageEntry } from "./skill_corpus_reachability.ts";

export interface ISkillValueInput {
  skillId: string;
  comparison: IPairedComparisonResult;
  deltaPromptTokens: number;
}

export interface ISkillValueReportRow {
  skillId: string;
  meanDelta: number;
  stdevDelta: number;
  valuePerToken: number;
  noEffect: boolean;
}

export interface ISkillValueReport {
  rows: ISkillValueReportRow[];
  nonCoverage: INonCoverageEntry[];
}

export function buildSkillValueReport(
  results: ISkillValueInput[],
  nonCoverage: INonCoverageEntry[],
): ISkillValueReport {
  const rows = results.map((result): ISkillValueReportRow => ({
    skillId: result.skillId,
    meanDelta: result.comparison.meanDelta,
    stdevDelta: result.comparison.stdevDelta,
    valuePerToken: computeValuePerToken(result.comparison.meanDelta, result.deltaPromptTokens),
    noEffect: result.comparison.noEffect,
  }));

  return { rows, nonCoverage };
}

function formatValuePerToken(value: number): string {
  if (value === Number.POSITIVE_INFINITY) return "+inf";
  if (value === Number.NEGATIVE_INFINITY) return "-inf";
  return value.toFixed(2);
}

export function renderSkillValueReportText(report: ISkillValueReport): string {
  const lines: string[] = [];
  lines.push("SKILL | DELTA | STDEV | VALUE/1K TOK | VERDICT");
  for (const row of report.rows) {
    const verdict = row.noEffect ? "NO EFFECT" : row.meanDelta > 0 ? "HELPS" : "HURTS";
    lines.push(
      `${row.skillId} | ${row.meanDelta.toFixed(2)} | ${row.stdevDelta.toFixed(2)} | ` +
        `${formatValuePerToken(row.valuePerToken)} | ${verdict}`,
    );
  }

  if (report.nonCoverage.length > 0) {
    lines.push("");
    lines.push("NON-COVERAGE:");
    for (const entry of report.nonCoverage) {
      lines.push(`${entry.skillId}: ${entry.reason}`);
    }
  }

  return lines.join("\n");
}
