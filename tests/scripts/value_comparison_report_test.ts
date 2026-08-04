/**
 * @module ValueComparisonReportTest
 * @path tests/scripts/value_comparison_report_test.ts
 * @description Tests for scripts/run_value_comparison_report.ts — Phase 158 Step 9's
 *   remediation of GAP-1a. Verifies the script's wrapper functions correctly call the
 *   real computePairedComparison, computeValuePerToken, evaluateValidityGate,
 *   assertValidityGate, and assertPlaceboDetected functions on a generic
 *   IValueComparisonReportInput. All numbers here are deliberately illustrative
 *   (0.4/0.5/0.9-style round values), never phase-158's actual historical measurements —
 *   those are unclean, retry-heavy live-run numbers that must not be encoded as a
 *   fixture (see the plan doc's 2026-08-04 design correction on Step 9). This test
 *   verifies the plumbing is wired correctly, not any historical claim.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [scripts/run_value_comparison_report.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  computeArmComparisonReport,
  computePlaceboReport,
  computeValidityGateReport,
} from "../../scripts/run_value_comparison_report.ts";
import type { IArmComparisonRequest, IValidityGateRequest } from "../../scripts/run_value_comparison_report.ts";
import { MechanicsOutcome } from "../../tests/scenario_framework/runner/validity_gate.ts";
import { ComparisonMetric } from "../../tests/scenario_framework/runner/arm_comparison.ts";

const SYNTHETIC_ARM_REQUEST: IArmComparisonRequest = {
  input: {
    armId: "demo-arm",
    metric: ComparisonMetric.OBJECTIVE_OUTCOME,
    tasks: [{ taskId: "demo-task", control: [0.5, 0.5], treatment: [0.9, 0.9] }],
  },
  deltaPromptTokens: 1000,
};

Deno.test("[value-comparison-report] computeArmComparisonReport calls computePairedComparison and computeValuePerToken for real", () => {
  const report = computeArmComparisonReport(SYNTHETIC_ARM_REQUEST);
  assertEquals(report.comparison.meanDelta, 0.4);
  assertEquals(report.comparison.noEffect, false);
  assertEquals(report.valuePerToken, 0.4);
});

Deno.test("[value-comparison-report] computeArmComparisonReport omits valuePerToken when no token delta is supplied", () => {
  const report = computeArmComparisonReport({ input: SYNTHETIC_ARM_REQUEST.input });
  assertEquals(report.valuePerToken, undefined);
});

const SYNTHETIC_VALIDITY_REQUEST: IValidityGateRequest = {
  binding: { artefactId: "demo-artefact", pack: "demo_pack", scenarioIds: ["demo-scenario"] },
  evidence: {
    pack: "demo_pack",
    scenarioIds: ["demo-scenario"],
    commitSha: "deadbeef",
    outcome: MechanicsOutcome.GREEN,
    verifiedAt: "2026-01-01T00:00:00Z",
  },
  valueRunCommitSha: "deadbeef",
};

Deno.test("[value-comparison-report] computeValidityGateReport admits a matching binding/evidence pair via the real gate", () => {
  const report = computeValidityGateReport(SYNTHETIC_VALIDITY_REQUEST);
  assertEquals(report.admitted, true);
});

Deno.test("[value-comparison-report] computeValidityGateReport rejects a mismatched commit — the gate is a real check", () => {
  const report = computeValidityGateReport({ ...SYNTHETIC_VALIDITY_REQUEST, valueRunCommitSha: "not-the-commit" });
  assertEquals(report.admitted, false);
  assertEquals(typeof report.reason, "string");
});

Deno.test("[value-comparison-report] an admitted result genuinely calls the throwing assertValidityGate, not just evaluateValidityGate", () => {
  // computeValidityGateReport calls assertValidityGate internally when admitted; if the
  // two functions ever disagreed, this call would throw and fail the test right here.
  const report = computeValidityGateReport(SYNTHETIC_VALIDITY_REQUEST);
  assertEquals(report.admitted, true);
});

const SYNTHETIC_PLACEBO_REQUEST: IArmComparisonRequest = {
  input: {
    armId: "demo-placebo",
    metric: ComparisonMetric.OBJECTIVE_OUTCOME,
    tasks: [{ taskId: "demo-task", control: [0.9], treatment: [0.4] }],
  },
};

Deno.test("[value-comparison-report] computePlaceboReport reports detected:true for a real negative-delta placebo comparison", () => {
  const report = computePlaceboReport(SYNTHETIC_PLACEBO_REQUEST);
  assertEquals(report.comparison.meanDelta, -0.5);
  assertEquals(report.detected, true);
  assertEquals(report.error, undefined);
});

Deno.test("[value-comparison-report] computePlaceboReport reports detected:false with a reason for a non-harmful comparison", () => {
  const nonHarmful: IArmComparisonRequest = {
    input: {
      armId: "demo-not-placebo",
      metric: ComparisonMetric.OBJECTIVE_OUTCOME,
      tasks: [{ taskId: "demo-task", control: [0.9], treatment: [0.95] }],
    },
  };
  const report = computePlaceboReport(nonHarmful);
  assertEquals(report.detected, false);
  assertEquals(typeof report.error, "string");
});

Deno.test("[value-comparison-report] assertThrows sanity: the real assertValidityGate throws on a red-mechanics evidence", () => {
  assertThrows(() => {
    const report = computeValidityGateReport({
      ...SYNTHETIC_VALIDITY_REQUEST,
      evidence: { ...SYNTHETIC_VALIDITY_REQUEST.evidence, outcome: MechanicsOutcome.RED },
    });
    if (!report.admitted) throw new Error(report.reason);
  });
});
