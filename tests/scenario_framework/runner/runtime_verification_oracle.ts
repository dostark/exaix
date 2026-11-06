/**
 * @module RuntimeVerificationOracle
 * @path tests/scenario_framework/runner/runtime_verification_oracle.ts
 * @description Scores the runtime verification-method plan for the five runtime cases.
 *   Each case has a positive assertion and a known-bad control that must fail.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [tests/scenario_framework/tests/unit/runtime_verification_oracle_test.ts]
 */

import { normalizeOracleText, requireAll, runTextOracle } from "./skill_oracle_helpers.ts";

/** One oracle decision and the reasons behind it. */
export interface IOracleResult {
  ok: boolean;
  reasons: string[];
}

/** Supported runtime verification case IDs. */
export const RUNTIME_VERIFICATION_CASES = [
  "p234-s4-c1",
  "p234-s4-c2",
  "p234-s4-c3",
  "p234-s4-c4",
  "p234-s4-c5",
] as const;

/** Scores one runtime verification case against the plan text. */
export function evaluatePlan(caseId: string, text: string): IOracleResult {
  if (!RUNTIME_VERIFICATION_CASES.includes(caseId as (typeof RUNTIME_VERIFICATION_CASES)[number])) {
    throw new Error(`Unknown runtime verification case: ${caseId}`);
  }
  const plan = normalizeOracleText(text);
  switch (caseId) {
    case "p234-s4-c1": {
      const base = requireAll(plan, [
        [/\bseed\b|bounded|fixed\b/, "uses a fixed seed and a bound"],
        [/minimi[sz]|reduc\b/, "preserves a minimized failing input"],
        [/malformed|token|regression\b/, "keeps the malformed case as a regression"],
      ]);
      const random = /unreproducible random failure\b/.test(plan) && !/minimi[sz]|reduc\b/.test(plan);
      return random ? { ok: false, reasons: [...base.reasons, "reports only a random failure"] } : base;
    }
    case "p234-s4-c2": {
      const base = requireAll(plan, [
        [/\bcontract\b|\bformula\b|\bmathemat|written\b/, "uses the written contract"],
        [/derive|independent|expected\b/, "derives the expected value"],
      ]);
      const copied = /copy[\s\S]{0,40}\b(?:source|implementation)\b|source code[\s\S]{0,20}expected\b/.test(plan);
      return copied ? { ok: false, reasons: [...base.reasons, "copies the expected value from the source"] } : base;
    }
    case "p234-s4-c3": {
      const base = requireAll(plan, [
        [/\bexample|fixed\b/, "uses ordinary examples"],
        [/no mutation|no fuzz|ordinary|not needed\b/, "explains why a campaign is not needed"],
      ]);
      const campaign =
        /(?:must|requires?|required)\s+(?:a\s+)?(?:mutation|fuzz)|mutation campaign|fuzz campaign\b/.test(plan) &&
        !/no (?:mutation|fuzz)(?: or (?:mutation|fuzz))? campaign|no campaign|not needed\b/.test(plan);
      return campaign ? { ok: false, reasons: [...base.reasons, "requires a campaign without a defect model"] } : base;
    }
    case "p234-s4-c4": {
      const base = requireAll(plan, [
        [/\bpublic\b|observable|contract\b/, "keeps the public contract"],
        [/unchanged|same output|no private\b/, "leaves the public output unchanged"],
      ]);
      const privateAssert = /private call|call graph|internal[\s\S]{0,20}assert\b/.test(plan) &&
        !/no private call|not[\s\S]{0,20}private call|assert no private\b/.test(plan);
      return privateAssert ? { ok: false, reasons: [...base.reasons, "asserts the private call graph"] } : base;
    }
    case "p234-s4-c5": {
      const base = requireAll(plan, [
        [/denied|authorization|authorize\b/, "covers the denied request"],
        [/zero write|no write|writer[\s\S]{0,20}not called|call count|substitute\b/, "observes zero writes"],
      ]);
      const responseProof = /success response[\s\S]{0,30}proof|response[\s\S]{0,20}no write\b/.test(plan);
      return responseProof ? { ok: false, reasons: [...base.reasons, "treats a response as proof of no write"] } : base;
    }
    default:
      throw new Error(`Unhandled runtime verification case: ${caseId}`);
  }
}

if (import.meta.main) await runTextOracle(evaluatePlan, "runtime_verification_oracle.ts");
