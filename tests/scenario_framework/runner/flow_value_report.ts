/**
 * @module ScenarioFrameworkFlowValueReport
 * @path tests/scenario_framework/runner/flow_value_report.ts
 * @description Phase 158 Step 6's flow value report: separates quality delta from cost
 * delta (tokens, wall clock) rather than blending them into one score — a flow that
 * improves quality at several times the cost is a different verdict from one that is
 * free, and a single blended number cannot distinguish the two. Pure computation only,
 * matching arm_comparison.ts's pattern — running the flow-ablation/flow-swap arms and
 * collecting their quality/token/wall-clock comparisons is the caller's concern.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/flow_value_report_test.ts, tests/scenario_framework/runner/arm_comparison.ts, tests/scenario_framework/runner/flow_corpus_reachability.ts]
 */

import type { IPairedComparisonResult } from "./arm_comparison.ts";
import type { IFlowNonCoverageEntry } from "./flow_corpus_reachability.ts";

export interface IFlowValueInput {
  flowId: string;
  qualityComparison: IPairedComparisonResult;
  tokenComparison: IPairedComparisonResult;
  wallClockComparison: IPairedComparisonResult;
}

export interface IFlowValueReportRow {
  flowId: string;
  qualityDelta: number;
  qualityNoEffect: boolean;
  tokenDelta: number;
  wallClockDeltaMs: number;
}

export interface IFlowValueReport {
  rows: IFlowValueReportRow[];
  nonCoverage: IFlowNonCoverageEntry[];
}

export function buildFlowValueReport(
  results: IFlowValueInput[],
  nonCoverage: IFlowNonCoverageEntry[],
): IFlowValueReport {
  const rows = results.map((result): IFlowValueReportRow => ({
    flowId: result.flowId,
    qualityDelta: result.qualityComparison.meanDelta,
    qualityNoEffect: result.qualityComparison.noEffect,
    tokenDelta: result.tokenComparison.meanDelta,
    wallClockDeltaMs: result.wallClockComparison.meanDelta,
  }));

  return { rows, nonCoverage };
}

export function renderFlowValueReportText(report: IFlowValueReport): string {
  const lines: string[] = [];
  lines.push("FLOW | QUALITY Δ | VERDICT | TOKENS Δ | WALL-CLOCK Δ (ms)");
  for (const row of report.rows) {
    const verdict = row.qualityNoEffect ? "NO EFFECT" : row.qualityDelta > 0 ? "HELPS" : "HURTS";
    lines.push(
      `${row.flowId} | ${row.qualityDelta.toFixed(2)} | ${verdict} | ${row.tokenDelta} | ${row.wallClockDeltaMs}`,
    );
  }

  if (report.nonCoverage.length > 0) {
    lines.push("");
    lines.push("NON-COVERAGE:");
    for (const entry of report.nonCoverage) {
      lines.push(`${entry.flowId}: ${entry.reason}`);
    }
  }

  return lines.join("\n");
}
