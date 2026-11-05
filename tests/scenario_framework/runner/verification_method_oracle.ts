/**
 * @module VerificationMethodOracle
 * @path tests/scenario_framework/runner/verification_method_oracle.ts
 * @description Scores the verification-method plan for the five development cases.
 *   Each case has a positive assertion and a known-bad control that must fail.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [tests/scenario_framework/tests/unit/verification_method_oracle_test.ts]
 */

import { join } from "@std/path";

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
] as const;

/** Normalizes plan text for stable matching. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Scores one verification-method case against the plan text. */
export function evaluatePlan(caseId: string, text: string): IOracleResult {
  if (!VERIFICATION_METHOD_CASES.includes(caseId as (typeof VERIFICATION_METHOD_CASES)[number])) {
    throw new Error(`Unknown verification-method case: ${caseId}`);
  }
  const plan = normalize(text);
  switch (caseId) {
    case "p234-s3-c1": {
      const base = requireAll(plan, [
        [/round[- ]trip|decode\(encode|encode then decode\b/, "selects the round-trip check"],
        [/malformed|invalid|reject|throw\b/, "covers malformed input"],
        [/\bcontract\b|\bproperty\b/, "derives the expectation from the contract"],
      ]);
      const copied = /expected\s*=\s*encode|copy[\s\S]{0,40}\boutput\b|implementation output\b/.test(plan);
      return copied ? { ok: false, reasons: [...base.reasons, "copies implementation output as the oracle"] } : base;
    }
    case "p234-s3-c2": {
      const base = requireAll(plan, [
        [/\bgrammar\b|independent|reference|specification\b/, "uses an independent grammar"],
        [/disagree|disagreement|differs?\b/, "names the disagreement"],
        [/investigate|explain|decide\b/, "investigates the disagreement"],
      ]);
      const parserOracle = /(?:old|new|either) parser[\s\S]{0,40}\b(?:oracle|expected)\b/.test(plan);
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
      const privateAssert = /assert[^.]{0,40}(?:joinparts|private helper|internal call)\b/.test(plan) &&
        !/do not assert|not assert|no private\b/.test(plan);
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
    default:
      throw new Error(`Unhandled verification-method case: ${caseId}`);
  }
}

/** Applies each assertion and collects the failures. */
function requireAll(plan: string, checks: Array<[RegExp, string]>): IOracleResult {
  const reasons: string[] = [];
  for (const [pattern, reason] of checks) {
    if (!pattern.test(plan)) reasons.push(`missing: ${reason}`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** Finds the newest plan file under the workspace. */
async function newestPlan(workspaceRoot: string): Promise<string> {
  const plansDir = join(workspaceRoot, "Workspace", "Plans");
  let newest: { path: string; mtime: number } | undefined;
  for await (const entry of Deno.readDir(plansDir)) {
    if (!entry.isFile || !entry.name.endsWith("_plan.md")) continue;
    const path = join(plansDir, entry.name);
    const info = await Deno.stat(path);
    const mtime = info.mtime?.getTime() ?? 0;
    if (!newest || mtime > newest.mtime) newest = { path, mtime };
  }
  if (!newest) throw new Error(`No plan file found under ${plansDir}`);
  return newest.path;
}

if (import.meta.main) {
  const [caseId, workspaceRoot] = Deno.args;
  if (!caseId || !workspaceRoot) {
    console.error("Usage: verification_method_oracle.ts <case-id> <workspace-root>");
    Deno.exit(2);
  }
  try {
    const planPath = await newestPlan(workspaceRoot);
    const text = await Deno.readTextFile(planPath);
    const result = evaluatePlan(caseId, text);
    console.log(JSON.stringify({ caseId, planPath, ...result }));
    Deno.exit(result.ok ? 0 : 1);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(2);
  }
}
