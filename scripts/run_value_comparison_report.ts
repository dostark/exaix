#!/usr/bin/env -S deno run -A

/**
 * @module RunValueComparisonReport
 * @path scripts/run_value_comparison_report.ts
 *
 * Usage:
 *   deno run -A scripts/run_value_comparison_report.ts <input.json>
 *   <input.json>  Path to an IValueComparisonReportInput JSON file.
 *
 * @description Phase 158 Steps 9-10's remediation of GAP-1a/GAP-1b: gives the phase's
 * value-computation pipeline a real, committed, non-test call-site —
 * `computePairedComparison`/`computeValuePerToken` (`arm_comparison.ts`),
 * `evaluateValidityGate`/`assertValidityGate`/`assertPlaceboDetected` (`validity_gate.ts`,
 * Step 9), `computeSkillReachability` (`skill_corpus_reachability.ts`), `planFullTrials`
 * (`skill_value_plan.ts`), `buildSkillValueReport` (`skill_value_report.ts`),
 * `assertSkillDecisionsRecorded` (`skill_value_decision.ts`), `groupDeltasByTaskType`
 * (`identity_task_type_report.ts`), `interpretPruneVerdict`
 * (`identity_config_prune_verdict.ts`), `computeFlowReachability`
 * (`flow_corpus_reachability.ts`), `buildFlowValueReport` (`flow_value_report.ts`), and
 * `computeJudgeCalibration` (`judge_calibration.ts`, Step 10). The 2026-08-04 post-gap
 * analysis found these functions had zero production callers despite six Reachability
 * Ledger rows claiming they computed published live-run numbers. This script is
 * deliberately generic — it reads paired-comparison input from an external JSON file
 * rather than embedding any of phase-158's own historical numbers, which are unclean,
 * retry-heavy live-run measurements that should not be encoded as a permanent fixture
 * (see the plan doc's 2026-08-04 design correction on Step 9). Real future live-run
 * data is meant to flow through this script instead of being transcribed into a
 * markdown table by hand. `computeJudgeCalibration` was initially left out of Step 10 on
 * the reasoning that a synthetic demonstration proves nothing about real calibration —
 * corrected before that step closed: the same "reachability and trustworthiness are
 * separate questions" principle already applied to every other function here applies to
 * it too, so it is wired the same way, on the same synthetic-only data discipline.
 * Operator-run only, same class as `scripts/check_artefact_decision_coverage.ts` and
 * `scripts/check_blueprint_integrity.ts` — not wired into CI.
 * @architectural-layer Script
 * @dependencies [tests/scenario_framework/runner/arm_comparison.ts, tests/scenario_framework/runner/validity_gate.ts, tests/scenario_framework/runner/skill_corpus_reachability.ts, tests/scenario_framework/runner/skill_value_plan.ts, tests/scenario_framework/runner/skill_value_report.ts, tests/scenario_framework/runner/skill_value_decision.ts, tests/scenario_framework/runner/identity_task_type_report.ts, tests/scenario_framework/runner/identity_config_prune_verdict.ts, tests/scenario_framework/runner/flow_corpus_reachability.ts, tests/scenario_framework/runner/flow_value_report.ts]
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
import {
  computeSkillReachability,
  type ICorpusTaskMatch,
  type IIdentityDefaultSkills,
  type INonCoverageEntry,
  type ISkillCatalogEntry,
  type ISkillReachabilityResult,
} from "../tests/scenario_framework/runner/skill_corpus_reachability.ts";
import { type IFullTrialCandidate, planFullTrials } from "../tests/scenario_framework/runner/skill_value_plan.ts";
import {
  buildSkillValueReport,
  type ISkillValueReport,
} from "../tests/scenario_framework/runner/skill_value_report.ts";
import {
  assertSkillDecisionsRecorded,
  type ISkillValueDecision,
} from "../tests/scenario_framework/runner/skill_value_decision.ts";
import {
  groupDeltasByTaskType,
  type ITaskTypeGroup,
} from "../tests/scenario_framework/runner/identity_task_type_report.ts";
import {
  interpretPruneVerdict,
  type PruneVerdict,
} from "../tests/scenario_framework/runner/identity_config_prune_verdict.ts";
import {
  computeFlowReachability,
  type IFlowCatalogEntry,
  type IFlowNonCoverageEntry,
  type IFlowReachabilityResult,
  type IFlowTaskCoverage,
} from "../tests/scenario_framework/runner/flow_corpus_reachability.ts";
import { buildFlowValueReport, type IFlowValueReport } from "../tests/scenario_framework/runner/flow_value_report.ts";
import {
  computeJudgeCalibration,
  type IJudgeCalibrationInput,
  type IJudgeCalibrationResult,
} from "../tests/scenario_framework/runner/judge_calibration.ts";

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

export interface ISkillReachabilityRequest {
  catalog: ISkillCatalogEntry[];
  defaultSkillIds: string[];
  corpusMatches: ICorpusTaskMatch[];
  /** Every shipped identity's declared default_skills, catalog-wide — not just the
   *  identity(ies) this run exercised. Optional: omitting it reproduces the original,
   *  narrower non-coverage reason. See `computeSkillReachability`'s docstring. */
  identityDefaultSkills?: IIdentityDefaultSkills[];
}

export interface ISkillFullTrialPlanRequest {
  screening: { skillId: string; input: IComparisonInput }[];
  criticalSkillIds: string[];
  topN: number;
}

export interface ISkillValueReportRequest {
  results: { skillId: string; input: IComparisonInput; deltaPromptTokens: number }[];
  nonCoverage: INonCoverageEntry[];
  decisions: ISkillValueDecision[];
}

export interface IIdentityTaskTypeRequest {
  input: IComparisonInput;
  taskTypeById: Record<string, string>;
}

export interface IIdentityPruneRequest {
  input: IComparisonInput;
}

export interface IFlowValueRequest {
  catalog: IFlowCatalogEntry[];
  coverage: IFlowTaskCoverage[];
  results: {
    flowId: string;
    qualityInput: IComparisonInput;
    tokenInput: IComparisonInput;
    wallClockInput: IComparisonInput;
  }[];
  nonCoverage?: IFlowNonCoverageEntry[];
}

export interface IValueComparisonReportInput {
  armComparisons?: IArmComparisonRequest[];
  validityGates?: IValidityGateRequest[];
  placeboArms?: IArmComparisonRequest[];
  skillReachability?: ISkillReachabilityRequest;
  skillFullTrialPlan?: ISkillFullTrialPlanRequest;
  skillValueReport?: ISkillValueReportRequest;
  identityTaskType?: IIdentityTaskTypeRequest;
  identityPrune?: IIdentityPruneRequest;
  flowValue?: IFlowValueRequest;
  judgeCalibration?: IJudgeCalibrationInput;
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

export interface ISkillValueReportResult {
  report: ISkillValueReport;
  decisionsOk: boolean;
  decisionsError?: string;
}

export interface IFlowValueReportResult {
  reachability: IFlowReachabilityResult;
  valueReport: IFlowValueReport;
}

/** Calls the real `computePairedComparison`, and `computeValuePerToken` when a token delta is supplied. */
export function computeArmComparisonReport(request: IArmComparisonRequest): IArmComparisonReport {
  const comparison = computePairedComparison(request.input);
  if (request.deltaPromptTokens === undefined) {
    return { comparison };
  }
  return { comparison, valuePerToken: computeValuePerToken(comparison.meanDelta, request.deltaPromptTokens) };
}

/** Calls the real `evaluateValidityGate`, then — when admitted — the real `assertValidityGate`
 *  too, confirming the throwing enforcement form agrees with the non-throwing one. */
export function computeValidityGateReport(request: IValidityGateRequest): IValidityGateResult {
  const result = evaluateValidityGate(request.binding, request.evidence, request.valueRunCommitSha);
  if (result.admitted) {
    // Must not throw: evaluateValidityGate already found this admitted, so the throwing
    // form disagreeing here would itself be a bug in the gate, worth surfacing loudly.
    assertValidityGate(request.binding, request.evidence, request.valueRunCommitSha);
  }
  return result;
}

/** Calls the real `computePairedComparison` then `assertPlaceboDetected`, catching the
 *  assertion's throw and reporting detected:false with the reason instead of aborting. */
export function computePlaceboReport(request: IArmComparisonRequest): IPlaceboReport {
  const comparison = computePairedComparison(request.input);
  try {
    assertPlaceboDetected(comparison);
    return { comparison, detected: true };
  } catch (error) {
    return { comparison, detected: false, error: (error as Error).message };
  }
}

/** Calls the real `computeSkillReachability`. */
export function computeSkillReachabilityReport(request: ISkillReachabilityRequest): ISkillReachabilityResult {
  return computeSkillReachability(
    request.catalog,
    request.defaultSkillIds,
    request.corpusMatches,
    request.identityDefaultSkills ?? [],
  );
}

/** Calls the real `computePairedComparison` per screening entry, then the real `planFullTrials`. */
export function computeSkillFullTrialPlan(request: ISkillFullTrialPlanRequest): IFullTrialCandidate[] {
  const screening = request.screening.map((entry) => ({
    skillId: entry.skillId,
    comparison: computePairedComparison(entry.input),
  }));
  return planFullTrials(screening, new Set(request.criticalSkillIds), request.topN);
}

/** Calls the real `computePairedComparison` per result, then `buildSkillValueReport` and
 *  `assertSkillDecisionsRecorded`, catching the decisions assertion's throw rather than
 *  aborting the whole report run. */
export function computeSkillValueReport(request: ISkillValueReportRequest): ISkillValueReportResult {
  const results = request.results.map((entry) => ({
    skillId: entry.skillId,
    comparison: computePairedComparison(entry.input),
    deltaPromptTokens: entry.deltaPromptTokens,
  }));
  const report = buildSkillValueReport(results, request.nonCoverage);
  try {
    assertSkillDecisionsRecorded(report, request.decisions);
    return { report, decisionsOk: true };
  } catch (error) {
    return { report, decisionsOk: false, decisionsError: (error as Error).message };
  }
}

/** Calls the real `computePairedComparison` then `groupDeltasByTaskType`. */
export function computeIdentityTaskTypeReport(request: IIdentityTaskTypeRequest): ITaskTypeGroup[] {
  const comparison = computePairedComparison(request.input);
  return groupDeltasByTaskType(comparison.perTask, request.taskTypeById);
}

/** Calls the real `computePairedComparison` then `interpretPruneVerdict`. */
export function computeIdentityPruneReport(request: IIdentityPruneRequest): PruneVerdict {
  return interpretPruneVerdict(computePairedComparison(request.input));
}

/** Calls the real `computeFlowReachability` and `buildFlowValueReport`. */
export function computeFlowValueReport(request: IFlowValueRequest): IFlowValueReportResult {
  const reachability = computeFlowReachability(request.catalog, request.coverage);
  const results = request.results.map((entry) => ({
    flowId: entry.flowId,
    qualityComparison: computePairedComparison(entry.qualityInput),
    tokenComparison: computePairedComparison(entry.tokenInput),
    wallClockComparison: computePairedComparison(entry.wallClockInput),
  }));
  const valueReport = buildFlowValueReport(results, request.nonCoverage ?? reachability.nonCoverage);
  return { reachability, valueReport };
}

/** Calls the real `computeJudgeCalibration`. Reachability and trustworthiness are separate
 *  questions; synthetic input proves the former exactly as validly here as elsewhere. */
export function computeJudgeCalibrationReport(input: IJudgeCalibrationInput): IJudgeCalibrationResult {
  return computeJudgeCalibration(input);
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

  if (input.skillReachability) {
    const result = computeSkillReachabilityReport(input.skillReachability);
    lines.push(
      `[skill-reachability] reachable=${result.reachableSkillIds.join(",")} nonCoverage=${result.nonCoverage.length}`,
    );
  }

  if (input.skillFullTrialPlan) {
    const candidates = computeSkillFullTrialPlan(input.skillFullTrialPlan);
    lines.push(`[skill-full-trial-plan] ${candidates.map((c) => `${c.skillId}(${c.reason})`).join(", ")}`);
  }

  if (input.skillValueReport) {
    const result = computeSkillValueReport(input.skillValueReport);
    lines.push(
      `[skill-value-report] rows=${result.report.rows.length} decisionsOk=${result.decisionsOk}` +
        (result.decisionsError ? ` error="${result.decisionsError}"` : ""),
    );
  }

  if (input.identityTaskType) {
    const groups = computeIdentityTaskTypeReport(input.identityTaskType);
    lines.push(`[identity-task-type] ${groups.map((g) => `${g.taskType}=${g.meanDelta}`).join(", ")}`);
  }

  if (input.identityPrune) {
    const verdict = computeIdentityPruneReport(input.identityPrune);
    lines.push(`[identity-prune] verdict=${verdict}`);
  }

  if (input.flowValue) {
    const result = computeFlowValueReport(input.flowValue);
    lines.push(
      `[flow-value] reachable=${result.reachability.reachableFlowIds.join(",")} rows=${result.valueReport.rows.length}`,
    );
  }

  if (input.judgeCalibration) {
    const result = computeJudgeCalibrationReport(input.judgeCalibration);
    lines.push(
      `[judge-calibration] ${result.judgeIdentityId}: correlation=${result.correlation} sampleCount=${result.sampleCount}`,
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
