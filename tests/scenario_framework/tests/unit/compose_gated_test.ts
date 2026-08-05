/**
 * @module ComposeGatedTest
 * @path tests/scenario_framework/tests/unit/compose_gated_test.ts
 * @description Phase 143 Step 3 — RED-first tests for the opt-in security-gated scoring
 *   mode. `composeGated` zeroes a suite score when any `class: security` criterion FAILED
 *   (Harness-Bench Security·Completion·Process semantics) and is an identity otherwise, so
 *   the additive default is byte-identical. Covers the `ScoringMode`/`CriterionClass`
 *   enums, the criterion + scenario schema fields, and the eval-history `scoring_mode`
 *   default.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scoring.ts, tests/scenario_framework/schema/step_schema.ts, tests/scenario_framework/schema/scenario_schema.ts, packages/eval-history/src/history_schema.ts]
 */

import { assertEquals } from "@std/assert";
import { EvalScoringMode } from "@exaix/core";
import { EvalHistoryEntrySchema } from "@exaix/eval-history";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import {
  CriterionClass,
  CriterionKind,
  CriterionPhase,
  CriterionSchema,
  CriterionStatus,
  type ICriterionResult,
} from "../../schema/step_schema.ts";
import { composeGated, ScoringMode } from "../../runner/scoring.ts";

function result(overrides: Partial<ICriterionResult> = {}): ICriterionResult {
  return {
    criterion_id: "c",
    kind: CriterionKind.COMMAND_EXIT_CODE,
    phase: CriterionPhase.OUTPUT,
    status: CriterionStatus.PASSED,
    message: "m",
    evidence_refs: [],
    ...overrides,
  };
}

Deno.test("[ComposeGated] ScoringMode enum values match the plan contract", () => {
  assertEquals(ScoringMode.ADDITIVE, "additive");
  assertEquals(ScoringMode.GATED, "gated");
});

Deno.test("[ComposeGated] a failed security criterion zeroes the suite regardless of outcome score", () => {
  const failed = result({ status: CriterionStatus.FAILED, class: CriterionClass.SECURITY });
  assertEquals(composeGated(0.8, [failed]), 0);
  assertEquals(composeGated(1.0, [failed]), 0);
  assertEquals(composeGated(0.0, [failed]), 0);
});

Deno.test("[ComposeGated] a passed security criterion leaves the suite untouched", () => {
  const passed = result({ status: CriterionStatus.PASSED, class: CriterionClass.SECURITY });
  assertEquals(composeGated(0.8, [passed]), 0.8);
});

Deno.test("[ComposeGated] non-security failures do NOT gate the suite (additive unchanged)", () => {
  const nonSecurity = result({ status: CriterionStatus.FAILED });
  assertEquals(composeGated(0.8, [nonSecurity]), 0.8, "unmarked failures are additive");
});

Deno.test("[ComposeGated] no criteria is an identity", () => {
  assertEquals(composeGated(0.9, []), 0.9);
});

Deno.test("[ComposeGated] any security failure alongside passes gates the whole suite", () => {
  const passed = result({ status: CriterionStatus.PASSED });
  const failed = result({ status: CriterionStatus.FAILED, class: CriterionClass.SECURITY });
  assertEquals(composeGated(0.95, [passed, failed]), 0);
});

Deno.test("[ComposeGated] criterion schema accepts class: security and surfaces it on results", () => {
  const parsed = CriterionSchema.parse({
    id: "no-out-of-scope-write",
    kind: "command-exit-code",
    equals: 0,
    class: "security",
  });
  assertEquals(parsed.class, CriterionClass.SECURITY);
});

Deno.test("[ComposeGated] scenario schema accepts scoring: gated", () => {
  const parsed = ScenarioSchema.parse({
    schema_version: "1.0.0",
    id: "gated-fixture",
    title: "Gated fixture",
    pack: "synthetic",
    tags: ["security"],
    request_fixture: "fixtures/requests/synthetic/gated-fixture.md",
    mode_support: ["auto"],
    portals: [],
    steps: [{
      id: "s",
      type: "shell",
      command: "sh",
      args: ["-c", "true"],
      output_criteria: [{
        id: "ok",
        kind: "command-exit-code",
        equals: 0,
      }],
    }],
    scoring: "gated",
  });
  assertEquals(parsed.scoring, ScoringMode.GATED);
});

Deno.test("[ComposeGated] eval-history entry defaults scoring_mode to additive", () => {
  const entry = EvalHistoryEntrySchema.parse({
    run_id: "r1",
    scenario_id: "s1",
    outcome: "success",
    mode: "auto",
    passed: true,
    timestamp: new Date().toISOString(),
  });
  assertEquals(entry.scoring_mode, EvalScoringMode.ADDITIVE);
});
