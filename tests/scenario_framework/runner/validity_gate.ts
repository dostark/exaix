/**
 * @module ScenarioFrameworkValidityGate
 * @path tests/scenario_framework/runner/validity_gate.ts
 * @description Phase 158 Step 3's validity gate: a value run for an artefact is
 * admissible only when the Phase 142 mechanics scenarios that cover it have a green
 * result recorded from the same commit as the value run — a value measurement over a
 * broken injection path is uninterpretable (Phase 142 Step 17's silently-dropped-skills
 * precedent). Also verifies a placebo (deliberately harmful) arm's paired comparison
 * shows a detectable effect, proving the pipeline can detect an effect at all on the
 * day it runs. Pure computation only, matching arm_comparison.ts's pattern — obtaining
 * the mechanics evidence and the current commit SHA is the caller's concern.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/arm_comparison.ts, tests/scenario_framework/runner/evidence_collector.ts, tests/scenario_framework/tests/unit/validity_gate_test.ts, tests/scenario_framework/tests/unit/placebo_arm_test.ts]
 */

import type { IPairedComparisonResult } from "./arm_comparison.ts";

/** The recorded outcome of the mechanics scenarios bound to an artefact. */
export enum MechanicsOutcome {
  GREEN = "green",
  RED = "red",
}

/** Binds an artefact to the mechanics scenarios that must be green, from the same
 *  commit, before a value run for it is admitted. */
export interface IMechanicsBinding {
  artefactId: string;
  pack: string;
  scenarioIds: string[];
}

/** A recorded mechanics result: which pack and scenarios ran, at which commit, and the
 *  outcome. Persisted alongside a value result (evidence_collector.ts's IRunManifest)
 *  so a later reader can tell mechanics evidence apart from the value result it gated. */
export interface IMechanicsEvidence {
  pack: string;
  scenarioIds: string[];
  commitSha: string;
  outcome: MechanicsOutcome;
  verifiedAt: string;
}

export interface IValidityGateResult {
  admitted: boolean;
  reason?: string;
}

/** Rejects a value run unless mechanics evidence covers the bound scenarios, matches
 *  the run's commit, and is green. */
export function evaluateValidityGate(
  binding: IMechanicsBinding,
  evidence: IMechanicsEvidence,
  valueRunCommitSha: string,
): IValidityGateResult {
  if (evidence.pack !== binding.pack) {
    return {
      admitted: false,
      reason: `mechanics evidence is for pack "${evidence.pack}", artefact "${binding.artefactId}" ` +
        `is bound to pack "${binding.pack}"`,
    };
  }

  const coveredScenarios = new Set(evidence.scenarioIds);
  const uncoveredScenarios = binding.scenarioIds.filter((id) => !coveredScenarios.has(id));
  if (uncoveredScenarios.length > 0) {
    return {
      admitted: false,
      reason: `mechanics evidence does not cover scenario(s) ${uncoveredScenarios.join(", ")} ` +
        `required for artefact "${binding.artefactId}"`,
    };
  }

  if (evidence.commitSha !== valueRunCommitSha) {
    return {
      admitted: false,
      reason: `mechanics evidence is from commit "${evidence.commitSha}", value run is at ` +
        `commit "${valueRunCommitSha}"`,
    };
  }

  if (evidence.outcome !== MechanicsOutcome.GREEN) {
    return {
      admitted: false,
      reason: `mechanics evidence for artefact "${binding.artefactId}" is ${evidence.outcome}, not green`,
    };
  }

  return { admitted: true };
}

/** Throws with the gate's reason when a value run is not admitted — the enforcement
 *  form callers use to reject a run outright rather than branch on `admitted`. */
export function assertValidityGate(
  binding: IMechanicsBinding,
  evidence: IMechanicsEvidence,
  valueRunCommitSha: string,
): void {
  const result = evaluateValidityGate(binding, evidence, valueRunCommitSha);
  if (!result.admitted) {
    throw new Error(`Validity gate rejected value run for artefact "${binding.artefactId}": ${result.reason}`);
  }
}

/** Verifies a placebo (deliberately harmful) arm's paired comparison shows a detectable,
 *  negative effect — proof the pipeline can detect an effect at all on the day it runs.
 *  A `noEffect` or non-negative result means detection itself is broken. */
export function assertPlaceboDetected(result: IPairedComparisonResult): void {
  if (result.noEffect) {
    throw new Error(
      `Placebo arm "${result.armId}" produced no detectable effect (meanDelta=${result.meanDelta}, ` +
        `stdevDelta=${result.stdevDelta}) — the pipeline cannot demonstrate detection capability.`,
    );
  }
  if (result.meanDelta >= 0) {
    throw new Error(
      `Placebo arm "${result.armId}" is expected to be harmful (negative delta) but measured ` +
        `meanDelta=${result.meanDelta}.`,
    );
  }
}
