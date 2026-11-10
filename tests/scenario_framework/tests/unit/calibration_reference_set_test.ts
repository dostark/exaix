/**
 * @module CalibrationReferenceSetTest
 * @path tests/scenario_framework/tests/unit/calibration_reference_set_test.ts
 * @description Checks the unreviewed Phase 234 reference set for completeness and oracle consistency.
 * @architectural-layer Test
 * @related-files [
 *   "tests/scenario_framework/fixtures/skill_eval/phase234/calibration/reference_set.json",
 *   "tests/scenario_framework/fixtures/skill_eval/phase234/calibration/reference_set_manifest.json"
 * ]
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "@exaix/testing";
import { evaluatePlan as evaluateDiagnosis } from "../../fixtures/skill_eval/phase234/bug_diagnosis_oracle.ts";
import { evaluatePlan as evaluateRuntimeDiagnosis } from "../../runner/bug_diagnosis_runtime_oracle.ts";
import { evaluatePlan as evaluateVerification } from "../../runner/verification_method_oracle.ts";
import { evaluatePlan as evaluateRuntimeVerification } from "../../runner/runtime_verification_oracle.ts";
import { evaluateRequirements } from "../../runner/requirements_discovery_oracle.ts";
import { evaluatePlanning } from "../../runner/planning_decisions_oracle.ts";
import reference from "../../fixtures/skill_eval/phase234/calibration/reference_set.json" with { type: "json" };
import manifest from "../../fixtures/skill_eval/phase234/calibration/reference_set_manifest.json" with { type: "json" };

interface IReferenceEntry {
  id: string;
  caseId: string;
  turn: string;
  kind: string;
  label: string;
  control: string | null;
  pairId: string | null;
  artifact: string;
  artifactSha256: string;
  source: string;
  reviewStatus: string;
}

const entries = reference.entries as IReferenceEntry[];

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function caseGroup(caseId: string): number {
  return Number(caseId[6]);
}

function oracleVerdict(entry: IReferenceEntry, prior?: string): { ok: boolean } {
  const group = caseGroup(entry.caseId);
  if (group === 1) return evaluateDiagnosis(entry.caseId, entry.artifact);
  if (group === 2) return evaluateRuntimeDiagnosis(entry.caseId, entry.artifact);
  if (group === 3) return evaluateVerification(entry.caseId, entry.artifact);
  if (group === 4) return evaluateRuntimeVerification(entry.caseId, entry.artifact);
  if (group === 5) return evaluateRequirements(entry.caseId, entry.artifact, prior);
  return evaluatePlanning(entry.caseId, entry.artifact);
}

Deno.test("the reference set covers every case with a positive and a negative control", () => {
  for (let group = 1; group <= 6; group++) {
    for (let index = 1; index <= 5; index++) {
      const caseId = `p234-s${group}-c${index}`;
      const caseEntries = entries.filter((entry) => entry.caseId === caseId);
      assert(caseEntries.some((entry) => entry.kind === "positive"), `${caseId} needs a positive`);
      assert(caseEntries.some((entry) => entry.kind === "negative"), `${caseId} needs a negative`);
      const control = caseEntries.find((entry) => entry.kind === "negative")?.control;
      assertEquals(control, manifest.controls[caseId as keyof typeof manifest.controls]);
      if (group <= 4) {
        assert(caseEntries.some((entry) => entry.kind === "equivalent"), `${caseId} needs an equivalent`);
      }
    }
  }
  assertEquals(manifest.caseCount, 30);
  assertEquals(manifest.entryCount, entries.length);
});

Deno.test("the reference set stays separate from live artifacts and keeps its hashes", async () => {
  for (const entry of entries) {
    assertEquals(await sha256(entry.artifact), entry.artifactSha256, entry.id);
    assertEquals(entry.reviewStatus, "pending-independent-review", entry.id);
    assert(!entry.artifact.includes("exaix-sandboxes"), `${entry.id} references a live sandbox`);
    assert(!entry.artifact.includes("/home/"), `${entry.id} references an absolute home path`);
  }
  const rubric = await Deno.readTextFile(
    join(REPO_ROOT, "exaix-dev-docs/planning/phase-234-case-rubric-mapping.md"),
  );
  const process = await Deno.readTextFile(
    join(REPO_ROOT, "exaix-dev-docs/planning/phase-234-semantic-evaluation-review.md"),
  );
  assertEquals(await sha256(rubric), reference.rubricSha256);
  assertEquals(await sha256(process), reference.processSha256);
  assertEquals(reference.rubricSha256, manifest.rubricSha256);
  assertEquals(reference.processSha256, manifest.processSha256);
});

Deno.test("every reference label agrees with the existing case oracle", () => {
  for (const entry of entries) {
    if (entry.kind === "negative") {
      const verdict = oracleVerdict(entry);
      assert(!verdict.ok, `${entry.id} must be rejected by its oracle: ${JSON.stringify(verdict)}`);
      continue;
    }
    const prior = entry.turn === "answered"
      ? entries.find((candidate) =>
        candidate.caseId === entry.caseId && candidate.turn === "initial" && candidate.kind === "positive" &&
        candidate.label === "passed"
      )?.artifact
      : undefined;
    if (entry.turn === "answered" && prior === undefined) {
      throw new Error(`${entry.id} has no initial artifact`);
    }
    const verdict = oracleVerdict(entry, prior);
    assert(verdict.ok, `${entry.id} must be accepted by its oracle: ${JSON.stringify(verdict)}`);
  }
});

Deno.test("the reference set does not claim independent review or calibration", () => {
  assertEquals(reference.status, "unreviewed-reference-set");
  assertEquals(reference.reviewStatus, "pending-independent-review");
  assertEquals(manifest.proposedCalibrationPolicy.status, "proposed-not-approved");
  assertStringIncludes(manifest.reviewStatus, "pending");
});
