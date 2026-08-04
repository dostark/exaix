#!/usr/bin/env -S deno run -A

/**
 * @module RunValueComparisonReport
 * @path scripts/run_value_comparison_report.ts
 *
 * Usage:
 *   deno run -A scripts/run_value_comparison_report.ts <input.json>
 *   <input.json>  Path to an IValueComparisonReportInput JSON file.
 *
 * @description Phase 158 Step 9's remediation of GAP-1a: gives
 * `computePairedComparison`/`computeValuePerToken` (`arm_comparison.ts`) and
 * `evaluateValidityGate`/`assertValidityGate`/`assertPlaceboDetected` (`validity_gate.ts`)
 * a real, committed, non-test call-site. The 2026-08-04 post-gap analysis found these
 * functions had zero production callers despite three Reachability Ledger rows claiming
 * they computed published live-run numbers. This script is deliberately generic — it
 * reads paired-comparison input from an external JSON file rather than embedding any of
 * phase-158's own historical numbers, which are unclean, retry-heavy live-run
 * measurements that should not be encoded as a permanent fixture (see the plan doc's
 * 2026-08-04 design correction on Step 9). Real future live-run data is meant to flow
 * through this script instead of being transcribed into a markdown table by hand.
 * Operator-run only, same class as `scripts/check_artefact_decision_coverage.ts` and
 * `scripts/check_blueprint_integrity.ts` — not wired into CI.
 * @architectural-layer Script
 * @dependencies [tests/scenario_framework/runner/arm_comparison.ts, tests/scenario_framework/runner/validity_gate.ts]
 * @related-files [tests/scripts/value_comparison_report_test.ts, scripts/check_artefact_decision_coverage.ts]
 */

import {
  type ComparisonMetric,
  computePairedComparison,
  computeValuePerToken,
  type IComparisonInput,
  type IPairedComparisonResult,
} from "../tests/scenario_framework/runner/arm_comparison.ts";
import {
  assertPlaceboDetected,
  assertValidityGate,
  evaluateValidityGate,
  type IMechanicsBinding,
  type IMechanicsEvidence,
  type IValidityGateResult,
} from "../tests/scenario_framework/runner/validity_gate.ts";

export interface IArmComparisonRequest {
  input: IComparisonInput;
  /** treatment - control prompt tokens; when supplied, value-per-1k-tokens is computed. */
  deltaPromptTokens?: number;
}

export interface IValidityGateRequest {
  binding: IMechanicsBinding;
  evidence: IMechanicsEvidence;
  valueRunCommitSha: string;
}

export interface IValueComparisonReportInput {
  armComparisons?: IArmComparisonRequest[];
  validityGates?: IValidityGateRequest[];
  placeboArms?: IArmComparisonRequest[];
}

export interface IArmComparisonReport {
  comparison: IPairedComparisonResult;
  valuePerToken?: number;
}

export interface IPlaceboReport {
  comparison: IPairedComparisonResult;
  detected: boolean;
  error?: string;
}

/** Calls the real `computePairedComparison`, and `computeValuePerToken` when a token
 *  delta is supplied — the arm-comparison half of GAP-1a's call-site. */
export function computeArmComparisonReport(request: IArmComparisonRequest): IArmComparisonReport {
  const comparison = computePairedComparison(request.input);
  if (request.deltaPromptTokens === undefined) {
    return { comparison };
  }
  return { comparison, valuePerToken: computeValuePerToken(comparison.meanDelta, request.deltaPromptTokens) };
}

/** Calls the real `evaluateValidityGate`, then — when admitted — the real
 *  `assertValidityGate` too, confirming the throwing enforcement form agrees with the
 *  non-throwing one rather than only ever calling one of the two. This is the
 *  validity-gate half of GAP-1a's call-site for both functions. */
export function computeValidityGateReport(request: IValidityGateRequest): IValidityGateResult {
  const result = evaluateValidityGate(request.binding, request.evidence, request.valueRunCommitSha);
  if (result.admitted) {
    // Must not throw: evaluateValidityGate already found this admitted, so the throwing
    // form disagreeing here would itself be a bug in the gate, worth surfacing loudly.
    assertValidityGate(request.binding, request.evidence, request.valueRunCommitSha);
  }
  return result;
}

/** Calls the real `computePairedComparison` then `assertPlaceboDetected` — the
 *  placebo-arm half of GAP-1a's call-site. Catches the assertion's throw and reports
 *  detected:false with the reason, rather than aborting the whole report run. */
export function computePlaceboReport(request: IArmComparisonRequest): IPlaceboReport {
  const comparison = computePairedComparison(request.input);
  try {
    assertPlaceboDetected(comparison);
    return { comparison, detected: true };
  } catch (error) {
    return { comparison, detected: false, error: (error as Error).message };
  }
}

function renderMetric(metric: ComparisonMetric): string {
  return metric;
}

function renderReport(input: IValueComparisonReportInput): string {
  const lines: string[] = [];

  for (const request of input.armComparisons ?? []) {
    const report = computeArmComparisonReport(request);
    lines.push(
      `[arm] ${request.input.armId} (${
        renderMetric(request.input.metric)
      }): meanDelta=${report.comparison.meanDelta} ` +
        `stdevDelta=${report.comparison.stdevDelta} noEffect=${report.comparison.noEffect}` +
        (report.valuePerToken === undefined ? "" : ` valuePerToken=${report.valuePerToken}`),
    );
  }

  for (const request of input.validityGates ?? []) {
    const result = computeValidityGateReport(request);
    lines.push(
      `[validity-gate] ${request.binding.artefactId}: admitted=${result.admitted}` +
        (result.reason ? ` reason="${result.reason}"` : ""),
    );
  }

  for (const request of input.placeboArms ?? []) {
    const report = computePlaceboReport(request);
    lines.push(
      `[placebo] ${request.input.armId}: meanDelta=${report.comparison.meanDelta} detected=${report.detected}` +
        (report.error ? ` error="${report.error}"` : ""),
    );
  }

  return lines.join("\n");
}

if (import.meta.main) {
  const inputPath = Deno.args[0];
  if (!inputPath) {
    console.error("Usage: deno run -A scripts/run_value_comparison_report.ts <input.json>");
    Deno.exit(2);
  }
  const input: IValueComparisonReportInput = JSON.parse(await Deno.readTextFile(inputPath));
  console.log(renderReport(input));
}
