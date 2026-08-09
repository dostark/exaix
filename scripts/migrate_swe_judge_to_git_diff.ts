#!/usr/bin/env -S deno run -A
/**
 * @module MigrateSweJudgeToGitDiff
 * @path scripts/migrate_swe_judge_to_git_diff.ts
 * @description Migrates every CODE-CHANGE swe_tasks scenario's llm-judge from the single-file
 *   evidence_path (llm-judge-input.txt, copied from a pre-picked src file) to the whole-branch
 *   git diff (evidence_diff_dir: "todo-app") judged against the task's reference patch
 *   (context_path: "$REFERENCE_PATCH"). Adds the scenario-level `reference_patch:` field,
 *   removes the prepare-evidence step, and drops the old evidence_path. Prose tasks (whose
 *   agent produces no code change) are left unchanged.
 *   Usage: deno run -A scripts/migrate_swe_judge_to_git_diff.ts [--dry-run]
 * @related-files [tests/scenario_framework/runner/assertions.ts, tests/scenario_framework/schema/step_schema.ts]
 */

const SCENARIO_DIR = new URL("../tests/scenario_framework/scenarios/swe_tasks/", import.meta.url);
const DRY_RUN = Deno.args.includes("--dry-run");

/** Prose tasks: the agent produces a plan/analysis, not code — a git diff judge is meaningless. */
const PROSE_TASKS = new Set(["explain-request-flow", "map-dependencies", "write-api-readme"]);

/** Flow-variant scenarios reuse a base task's fixture and reference patch. */
const FLOW_VARIANT_TASK: Record<string, string> = {
  "add-feature-endpoint-feature-development": "add-feature-endpoint",
  "add-feature-endpoint-refactoring": "add-feature-endpoint",
};

async function collectScenarios(): Promise<string[]> {
  const out: string[] = [];
  for await (const f of Deno.readDir(SCENARIO_DIR)) {
    if (f.name.endsWith(".yaml")) out.push(f.name);
  }
  return out.sort();
}

function hasReferencePatch(task: string): boolean {
  try {
    Deno.statSync(`tests/scenario_framework/fixtures/swe_tasks/${task}/reference.patch`);
    return true;
  } catch {
    return false;
  }
}

function rewriteScenario(txt: string): { out: string; changed: boolean } {
  if (!txt.includes('evidence_path: "llm-judge-input.txt"')) {
    return { out: txt, changed: false };
  }
  const task = txt.match(/request_fixture: "fixtures\/requests\/swe_tasks\/([^.]+)\.md"/)?.[1];
  if (!task) return { out: txt, changed: false };
  const baseTask = FLOW_VARIANT_TASK[task] ?? task;
  if (PROSE_TASKS.has(baseTask) || !hasReferencePatch(baseTask)) {
    return { out: txt, changed: false };
  }

  // 1) Declare reference_patch after request_fixture.
  let out = txt.replace(
    /(request_fixture: "fixtures\/requests\/swe_tasks\/[^"]+\.md"\n)/,
    `$1reference_patch: "fixtures/swe_tasks/${baseTask}/reference.patch"\n`,
  );

  // 2) Remove the prepare-evidence step (source/target/llm-judge-input.txt) entirely. Tolerates
  // both a trailing blank line and a directly-following next step (flow-variant scenarios).
  out = out.replace(
    / {2}- id: "prepare-llm-judge-evidence"\n(?: {4}type: "prepare-evidence"\n {4}cwd: "[^"]+"\n {4}source: "[^"]+"\n {4}target: "llm-judge-input.txt"\n {4}output_criteria:\n {6}- id: "evidence-prepared"\n {8}kind: "command-exit-code"\n {8}equals: 0\n)(?:\n)?/,
    "",
  );

  // 3) Switch the judge criterion to the whole-branch diff + reference-patch context. Handles
  // both a following context_path (standard swe_tasks) and its absence (legacy variants).
  out = out.replace(
    / {8}evidence_path: "llm-judge-input.txt"\n(?: {8}context_path: "\$REQUEST_FIXTURE"\n)?/,
    "        # Code-change task: the judge reviews the FULL worktree branch diff (the applied\n" +
      "        # changes) against the task's reference patch — never a pre-picked single file.\n" +
      '        evidence_diff_dir: "todo-app"\n' +
      '        context_path: "$REFERENCE_PATCH"\n',
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
  console.log(`total code-change scenarios migrated: ${total}`);
}

await main();
