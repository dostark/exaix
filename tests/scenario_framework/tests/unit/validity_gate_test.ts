/**
 * @module ScenarioFrameworkValidityGateTest
 * @path tests/scenario_framework/tests/unit/validity_gate_test.ts
 * @description Tests for Phase 158 Step 3's validity gate: a value run for an artefact
 * is admissible only when the Phase 142 mechanics scenarios that cover it have a green
 * result recorded from the same commit as the value run. A value measurement over a
 * broken injection path is uninterpretable (Phase 142 Step 17's silently-dropped-skills
 * precedent), so the gate rejects rather than warns.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/validity_gate.ts, tests/scenario_framework/runner/evidence_collector.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  assertValidityGate,
  evaluateValidityGate,
  type IMechanicsBinding,
  type IMechanicsEvidence,
  MechanicsOutcome,
} from "../../runner/validity_gate.ts";
import { writeRunManifest } from "../../runner/evidence_collector.ts";
import type { IRunManifest } from "../../runner/evidence_collector.ts";

function makeBinding(overrides: Partial<IMechanicsBinding> = {}): IMechanicsBinding {
  return {
    artefactId: "skill-tdd-methodology",
    pack: "skill_eval",
    scenarioIds: ["pin-batch-1", "engine-trigger-matching"],
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<IMechanicsEvidence> = {}): IMechanicsEvidence {
  return {
    pack: "skill_eval",
    scenarioIds: ["pin-batch-1", "engine-trigger-matching", "engine-defaults-merge"],
    commitSha: "abc1234",
    outcome: MechanicsOutcome.GREEN,
    verifiedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

Deno.test("[ValidityGate] green mechanics from the same commit admits the value run", () => {
  const result = evaluateValidityGate(makeBinding(), makeEvidence(), "abc1234");
  assertEquals(result.admitted, true);
});

Deno.test("[ValidityGate] red mechanics is rejected, with the reason recorded", () => {
  const result = evaluateValidityGate(
    makeBinding(),
    makeEvidence({ outcome: MechanicsOutcome.RED }),
    "abc1234",
  );
  assertEquals(result.admitted, false);
  assertEquals(result.reason?.includes("red"), true);
});

Deno.test("[ValidityGate] assertValidityGate throws for red mechanics, naming the artefact", () => {
  assertThrows(
    () => assertValidityGate(makeBinding(), makeEvidence({ outcome: MechanicsOutcome.RED }), "abc1234"),
    Error,
    "skill-tdd-methodology",
  );
});

Deno.test("[ValidityGate] mechanics evidence from a different commit is rejected", () => {
  const result = evaluateValidityGate(makeBinding(), makeEvidence({ commitSha: "def5678" }), "abc1234");
  assertEquals(result.admitted, false);
  assertEquals(result.reason?.includes("commit"), true);
});

Deno.test("[ValidityGate] mechanics evidence for a different pack is rejected", () => {
  const result = evaluateValidityGate(makeBinding(), makeEvidence({ pack: "agent_role_eval" }), "abc1234");
  assertEquals(result.admitted, false);
  assertEquals(result.reason?.includes("pack"), true);
});

Deno.test("[ValidityGate] mechanics evidence that does not cover a bound scenario is rejected", () => {
  const result = evaluateValidityGate(
    makeBinding({ scenarioIds: ["pin-batch-1", "pin-batch-2"] }),
    makeEvidence({ scenarioIds: ["pin-batch-1"] }),
    "abc1234",
  );
  assertEquals(result.admitted, false);
  assertEquals(result.reason?.includes("pin-batch-2"), true);
});

Deno.test("[ValidityGate] mechanics evidence covering a superset of bound scenarios still admits", () => {
  const result = evaluateValidityGate(
    makeBinding({ scenarioIds: ["pin-batch-1"] }),
    makeEvidence({ scenarioIds: ["pin-batch-1", "pin-batch-2", "pin-batch-3"] }),
    "abc1234",
  );
  assertEquals(result.admitted, true);
});

Deno.test("[ValidityGate] mechanics evidence is persisted in the run manifest alongside the value result, distinct from armComparison", async () => {
  const evidence = makeEvidence();
  const manifest: IRunManifest = {
    scenarioId: "skill-tdd-methodology-value",
    pack: "artefact_value",
    mode: "live",
    outcome: "success",
    steps: [],
    mechanicsEvidence: evidence,
  };

  const tempDir = await Deno.makeTempDir();
  try {
    const manifestPath = await writeRunManifest({ outputDir: tempDir, manifest });
    const written = JSON.parse(await Deno.readTextFile(manifestPath)) as IRunManifest;
    assertEquals(written.mechanicsEvidence, evidence);
    assertEquals(written.armComparison, undefined);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
