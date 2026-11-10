/**
 * @module VerificationMethodOracle
 * @path tests/scenario_framework/runner/verification_method_oracle.ts
 * @description Scores the verification-method plan for the five development cases.
 *   Each case has a positive assertion and a known-bad control that must fail.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [tests/scenario_framework/tests/unit/verification_method_oracle_test.ts]
 */

import { normalizeOracleText, requireAll, runTextOracle } from "./skill_oracle_helpers.ts";

/** One oracle decision and the reasons behind it. */
export interface IOracleResult {
  ok: boolean;
  reasons: string[];
}

/** Supported verification-method case IDs. */
export const VERIFICATION_METHOD_CASES = [
  "p234-s3-c1",
  "p234-s3-c2",
  "p234-s3-c3",
  "p234-s3-c4",
  "p234-s3-c5",
  "p234-v3-c1",
  "p234-v3-c2",
  "p234-v3-c3",
] as const;

/** Scores one verification-method case against the plan text. */
export function evaluatePlan(caseId: string, text: string): IOracleResult {
  if (!VERIFICATION_METHOD_CASES.includes(caseId as (typeof VERIFICATION_METHOD_CASES)[number])) {
    throw new Error(`Unknown verification-method case: ${caseId}`);
  }
  const plan = normalizeOracleText(text);
  switch (caseId) {
    case "p234-s3-c1": {
      const base = requireAll(plan, [
        [/round[- ]trip|decode\(encode|encode then decode\b/, "selects the round-trip check"],
        [/malformed|invalid|reject|throw\b/, "covers malformed input"],
        [/\bcontract\b|\bproperty\b/, "derives the expectation from the contract"],
      ]);
      const claim = plan.replace(/\bnot\s+(?:from\s+)?(?:the\s+)?(?:observed\s+)?implementation output\b/g, "")
        .replace(/do not derive[^.\n]{0,60}from implementation output/g, "");
      const copied = /expected\s*=\s*encode|copy[\s\S]{0,40}\boutput\b|implementation output\b/.test(claim);
      return copied ? { ok: false, reasons: [...base.reasons, "copies implementation output as the oracle"] } : base;
    }
    case "p234-s3-c2": {
      const base = requireAll(plan, [
        [/\bgrammar\b|independent|reference|specification\b/, "uses an independent grammar"],
        [/disagree|disagreement|differs?\b/, "names the disagreement"],
        [/investigate|explain|decide\b/, "investigates the disagreement"],
      ]);
      const parserOracle = /(?:old|new|either) parser[^.\n]{0,40}\b(?:oracle|expected)\b/.test(plan);
      return parserOracle ? { ok: false, reasons: [...base.reasons, "treats a parser as the oracle"] } : base;
    }
    case "p234-s3-c3": {
      const base = requireAll(plan, [
        [/\bexample|fixed|table\b/, "keeps ordinary examples"],
        [
          /no fuzz|fuzz[\s\S]{0,40}no|not[\s\S]{0,20}fuzz|no mutation|ordinary\b/,
          "explains why a campaign is not needed",
        ],
      ]);
      const campaign =
        /(?:must|requires?|required)\s+(?:a\s+)?fuzz|require[\s\S]{0,20}fuzz|mutation campaign required\b/.test(plan);
      return campaign
        ? { ok: false, reasons: [...base.reasons, "requires a fuzz or mutation campaign by default"] }
        : base;
    }
    case "p234-s3-c4": {
      const base = requireAll(plan, [
        [/\bpublic\b|observable|contract\b/, "keeps the public contract"],
        [/unchanged|same output|no private|not[\s\S]{0,20}private\b/, "leaves the public output unchanged"],
      ]);
      const privateAssert = plan.split(/[.\n]/).some((sentence) =>
        /assert[^.]{0,40}(?:joinparts|private helper|internal call)\b/.test(sentence) &&
        !/\bif\b[^.]*\b(?:may|might|could) fail\b|do not assert|not assert|not inspect or assert|no tests? assert|no private\b|no reference to/
          .test(
            sentence,
          )
      );
      return privateAssert
        ? { ok: false, reasons: [...base.reasons, "asserts a private helper or internal call"] }
        : base;
    }
    case "p234-s3-c5": {
      const base = requireAll(plan, [
        [/call count|attempts?\b|retry\b/, "observes the retry attempt count"],
        [/denied|authorization|authorize\b/, "covers the denied write"],
        [/\bsubstitute\b|\bfake\b|interaction|observable\b/, "keeps the contract interaction"],
      ]);
      const blanket = /no mocks|ban[\s\S]{0,20}mock|no substitutes|no interaction\b/.test(plan);
      return blanket ? { ok: false, reasons: [...base.reasons, "bans substitutes or interaction checks"] } : base;
    }
    case "p234-v3-c1": {
      const base = requireAll(plan, [
        [/\bexample|fixed\b/, "keeps ordinary examples"],
        [/\bcanary\b/, "adds a canary"],
        [/no fuzz|not needed|no mutation\b/, "explains why a campaign is not needed"],
      ]);
      const campaign = /(?:must|requires?|required)\s+(?:a\s+)?fuzz|fuzz campaign required\b/.test(plan);
      return campaign ? { ok: false, reasons: [...base.reasons, "requires a fuzz campaign by default"] } : base;
    }
    case "p234-v3-c2":
      return requireAll(plan, [
        [/\bproperty\b/, "selects a property test"],
        [/\bcontract\b/, "derives the property from the contract"],
        [/\bseed\b/, "fixes the seed"],
        [/\bbound|bounded|100\b/, "bounds the cases"],
      ]);
    case "p234-v3-c3": {
      const base = requireAll(plan, [
        [/differential|compare\b/, "selects a differential check"],
        [/reference|existing parser\b/, "uses the independent reference"],
        [/disagree|disagreement\b/, "investigates disagreements"],
      ]);
      const parserOracle = /new parser[\s\S]{0,40}\b(?:oracle|expected)\b/.test(plan);
      return parserOracle ? { ok: false, reasons: [...base.reasons, "treats the new parser as the oracle"] } : base;
    }
    default:
      throw new Error(`Unhandled verification-method case: ${caseId}`);
  }
}

if (import.meta.main) await runTextOracle(evaluatePlan, "verification_method_oracle.ts");
