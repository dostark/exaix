/**
 * @module BugDiagnosisOracle
 * @path tests/scenario_framework/fixtures/skill_eval/phase234/bug_diagnosis_oracle.ts
 * @description Scores the fix-bug diagnosis plan for the five bug-diagnosis cases.
 *   Each case has a positive assertion and a known-bad control that must fail.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [tests/scenario_framework/tests/unit/bug_diagnosis_oracle_test.ts]
 */

import { normalizeOracleText, requireAll, runTextOracle } from "../../../runner/skill_oracle_helpers.ts";

/** One oracle decision and the reasons behind it. */
export interface IOracleResult {
  ok: boolean;
  reasons: string[];
}

/** Supported case IDs. */
export const BUG_DIAGNOSIS_CASES = [
  "p234-s1-c1",
  "p234-s1-c2",
  "p234-s1-c3",
  "p234-s1-c4",
  "p234-s1-c5",
] as const;

/** Scores one case against the plan text. */
export function evaluatePlan(caseId: string, text: string): IOracleResult {
  if (!BUG_DIAGNOSIS_CASES.includes(caseId as (typeof BUG_DIAGNOSIS_CASES)[number])) {
    throw new Error(`Unknown bug-diagnosis case: ${caseId}`);
  }
  const plan = normalizeOracleText(text);
  switch (caseId) {
    case "p234-s1-c1":
      return requireAll(plan, [
        [/\bduplicat|twice|double\b/, "names the duplicate write"],
        [/\bcount|assert|frequency|row\b/, "names a row-count assertion"],
      ]);
    case "p234-s1-c2": {
      const base = requireAll(plan, [
        [/\b20\b|twenty attempts|attempts?\b/, "records the attempt count"],
        [/\bfrequency|duplicateruns|duplicate count|\b\d+\s*\/\s*20\b|percent\b/, "records the observed frequency"],
      ]);
      const deterministic = /\b(?:is|reproduces?|confirmed)\s+deterministic|always reproduces\b/.test(plan) &&
        !/\b(?:not|no|never|without)\s+deterministic\b/.test(plan);
      return deterministic
        ? { ok: false, reasons: [...base.reasons, "claims deterministic reproduction"] }
        : base;
    }
    case "p234-s1-c3": {
      const base = requireAll(plan, [
        [/scripts\/repro\.sh|repro\.sh\b/, "names the reproduction command"],
        [/\bnot found\b|\bmissing\b|no such file|\bunavailable\b/, "records the missing tool"],
        [/\bcannot\b|\bblocked\b|no reproduction|missing evidence\b/, "states the missing evidence"],
      ]);
      const speculated = /diff --git|```diff|\bapply this (?:fix|patch)\b/.test(plan);
      return speculated
        ? { ok: false, reasons: [...base.reasons, "applies a speculative fix"] }
        : base;
    }
    case "p234-s1-c4": {
      const base = requireAll(plan, [
        [/\bexit(?:s|ed)?\s*(?:code\s*)?0\b|exit-zero\b/, "names the exit-zero check"],
        [/\bnot (?:proof|evidence|sufficient)\b|\breject\b|\binsufficient\b|does not assert|no symptom assertion\b/, "rejects exit zero"],
      ]);
      const accepted = /\bexit(?:s|ed)?\s*(?:code\s*)?0\b[^.]{0,60}\b(?:proves|confirms|means|fixed)\b/.test(plan);
      return accepted
        ? { ok: false, reasons: [...base.reasons, "accepts exit zero as proof"] }
        : base;
    }
    case "p234-s1-c5": {
      const base = requireAll(plan, [
        [/\b2\b[\s\S]{0,80}\b8\b|\b8\b[\s\S]{0,80}\b2\b/, "names both worker counts"],
        [/same workload|identical workload|comparable|not comparable|withhold|unverified|no (?:valid )?improvement\b/, "withholds the improvement verdict"],
      ]);
      const claimed = /\b(?:is|shows?|confirms?)\s+(?:a\s+)?(?:speedup|improvement)\b|\bfaster\b/.test(plan) &&
        !/\b(?:not|no|without|withhold)\s+(?:a\s+)?(?:speedup|improvement)\b|\bnot faster\b/.test(plan);
      return claimed
        ? { ok: false, reasons: [...base.reasons, "claims a speedup from unequal runs"] }
        : base;
    }
    default:
      throw new Error(`Unhandled bug-diagnosis case: ${caseId}`);
  }
}

if (import.meta.main) await runTextOracle(evaluatePlan, "bug_diagnosis_oracle.ts");
