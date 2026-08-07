#!/usr/bin/env -S deno run -A
/**
 * @module MigrateSweJudgeTestStatus
 * @path scripts/migrate_swe_judge_test_status.ts
 * @description For every CODE-CHANGE swe_tasks scenario (one whose llm-judge uses
 *   evidence_diff_dir): (1) marks the verify-tests step `continue_on_failure: true` so a
 *   failing test run no longer halts the scenario and skips the judge, and (2) adds
 *   `test_run_source: "verify-tests"` to the llm-judge criterion so the judge receives the
 *   test-run status (PASSED/FAILED + exit code + output) as additional context.
 *   Usage: deno run -A scripts/migrate_swe_judge_test_status.ts [--dry-run]
 * @related-files [tests/scenario_framework/runner/modes.ts, tests/scenario_framework/runner/assertions.ts]
 */

const SCENARIO_DIR = new URL("../tests/scenario_framework/scenarios/swe_tasks/", import.meta.url);
const DRY_RUN = Deno.args.includes("--dry-run");

async function collectScenarios(): Promise<string[]> {
  const out: string[] = [];
  for await (const f of Deno.readDir(SCENARIO_DIR)) {
    if (f.name.endsWith(".yaml")) out.push(f.name);
  }
  return out.sort();
}

function rewriteScenario(txt: string): { out: string; changed: boolean } {
  if (!txt.includes("evidence_diff_dir: \"todo-app\"")) {
    return { out: txt, changed: false };
  }
  let out = txt;

  // 1) verify-tests: continue_on_failure so the judge still runs on a failing test run.
  out = out.replace(
    /(  - id: "verify-tests"\n    type: "test-run"\n    cwd: "todo-app"\n    command: "deno"\n    args: \[[^\]]*\]\n)/,
    "$1    # A failing test run must NOT skip the judge: the failure is the signal being graded.\n    continue_on_failure: true\n",
  );

  // 2) llm-judge criterion: pass the test-run status as additional context.
  out = out.replace(
    /(        context_path: "\$REFERENCE_PATCH"\n)(?=\s*score_threshold)/,
    "$1        # Pass the verify-tests outcome (PASSED/FAILED + exit code + output) to the judge.\n        test_run_source: \"verify-tests\"\n",
  );

  return { out, changed: out !== txt };
}

async function main(): Promise<void> {
  const files = await collectScenarios();
  let total = 0;
  for (const file of files) {
    const path = new URL(file, SCENARIO_DIR);
    const txt = await Deno.readTextFile(path);
    const { out, changed } = rewriteScenario(txt);
    if (changed) {
      console.log(file);
      total++;
      if (!DRY_RUN) await Deno.writeTextFile(path, out);
    }
  }
  console.log(`total scenarios updated: ${total}`);
}

await main();
