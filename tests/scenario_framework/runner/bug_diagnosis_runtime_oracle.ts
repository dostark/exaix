/**
 * @module BugDiagnosisRuntimeOracle
 * @path tests/scenario_framework/runner/bug_diagnosis_runtime_oracle.ts
 * @description Scores the runtime fix-bug diagnosis plan for the five runtime cases.
 *   Each case has a positive assertion and a known-bad control that must fail.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [tests/scenario_framework/tests/unit/bug_diagnosis_runtime_oracle_test.ts]
 */

import { join } from "@std/path";

/** One oracle decision and the reasons behind it. */
export interface IOracleResult {
  ok: boolean;
  reasons: string[];
}

/** Supported runtime case IDs. */
export const BUG_DIAGNOSIS_RUNTIME_CASES = [
  "p234-s2-c1",
  "p234-s2-c2",
  "p234-s2-c3",
  "p234-s2-c4",
  "p234-s2-c5",
] as const;

/** Normalizes plan text for stable matching. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Scores one runtime case against the plan text. */
export function evaluatePlan(caseId: string, text: string): IOracleResult {
  if (!BUG_DIAGNOSIS_RUNTIME_CASES.includes(caseId as (typeof BUG_DIAGNOSIS_RUNTIME_CASES)[number])) {
    throw new Error(`Unknown runtime diagnosis case: ${caseId}`);
  }
  const plan = normalize(text);
  switch (caseId) {
    case "p234-s2-c1": {
      const base = requireAll(plan, [
        [/run-tests\.sh|\.\/run-tests\b/, "uses the project test command"],
        [/duplicat|twice|row count|assert\b/, "asserts the duplicate symptom"],
      ]);
      const wrongTool = /\bdeno\b|inittestdbservice|createclitestcontext\b/.test(plan);
      return wrongTool ? { ok: false, reasons: [...base.reasons, "uses a Deno command or Exaix helper"] } : base;
    }
    case "p234-s2-c2": {
      const base = requireAll(plan, [
        [/two callers|both callers|two-caller|caller 1[\s\S]{0,40}caller 2\b/, "keeps both callers"],
        [/fails? before|\bred\b|before the patch|before the fix\b/, "requires RED before the patch"],
      ]);
      const oneCaller = /\bone caller|single caller\b/.test(plan);
      return oneCaller ? { ok: false, reasons: [...base.reasons, "replaces the race with a single caller"] } : base;
    }
    case "p234-s2-c3": {
      const base = requireAll(plan, [
        [/\bmytool\b/, "names the missing runner"],
        [/not installed|not found|\bmissing\b|\bunavailable\b/, "records the missing tool"],
        [/\bpending\b|\bblocked\b|not fixed|\bcannot\b|\bleave\b/, "leaves the fix pending"],
      ]);
      const claimed =
        /\bdefect is fixed\b|\b(?:fixed|resolved)\b[^.]{0,40}\b(?:without|no)\b[^.]{0,20}\b(?:execution|reproduction)\b/
          .test(plan);
      return claimed ? { ok: false, reasons: [...base.reasons, "reports the defect fixed without execution"] } : base;
    }
    case "p234-s2-c4": {
      const base = requireAll(plan, [
        [
          /no red|without red|before[\s\S]{0,40}\bred\b|\bblock\b[\s\S]{0,40}\bpatch\b|do not (?:apply|patch)\b/,
          "blocks the patch until RED",
        ],
        [/\bsymptom\b|\bred\b|\bregression\b/, "names the symptom-sensitive regression"],
      ]);
      const accepted =
        /source explanation[\s\S]{0,40}\b(?:is|as)\b[\s\S]{0,10}\bred\b|no regression needed|\bexplanation is enough\b/
          .test(plan);
      return accepted ? { ok: false, reasons: [...base.reasons, "accepts the source explanation as RED"] } : base;
    }
    case "p234-s2-c5": {
      const base = requireAll(plan, [
        [/\b100\b[\s\S]{0,80}\b10000\b|\b10000\b[\s\S]{0,80}\b100\b/, "names both iteration counts"],
        [
          /same workload|identical workload|comparable|not comparable|\bunverified\b|\bwithhold\b/,
          "withholds the improvement verdict",
        ],
      ]);
      const claimed = /\b(?:is|shows?|confirms?)\s+(?:a\s+)?(?:speedup|improvement)\b|\bfaster\b/.test(plan) &&
        !/\b(?:not|no|without|withhold)\s+(?:a\s+)?(?:speedup|improvement)\b|\bnot faster\b/.test(plan);
      return claimed ? { ok: false, reasons: [...base.reasons, "claims a speedup from unequal inputs"] } : base;
    }
    default:
      throw new Error(`Unhandled runtime diagnosis case: ${caseId}`);
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
    console.error("Usage: bug_diagnosis_runtime_oracle.ts <case-id> <workspace-root>");
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
