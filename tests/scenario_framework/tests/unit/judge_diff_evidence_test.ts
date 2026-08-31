/**
 * @module ScenarioFrameworkJudgeDiffEvidenceTest
 * @path tests/scenario_framework/tests/unit/judge_diff_evidence_test.ts
 * @description Tests for computing a git diff as LLM-judge evidence instead of a raw
 * final-state file dump. Live-observed 2026-08-02: two of ten repeated judge calls on
 * identical, genuinely-fixed evidence hallucinated "does not represent a diff/fix" and
 * "the original buggy fixture file, not a fixed version" — the judge was never shown
 * that anything changed, only the final state, and had to guess. A diff against the
 * portal's own root commit (created by every swe_tasks scenario's setup-portal-repo
 * step) makes "did anything change" unambiguous and deterministic — computed here,
 * harness-side, not left to the judge to retrieve itself (that's a separate, larger
 * escalation requiring its own security review of what claude -p permits for Bash).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/assertions.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { computeGitDiffEvidence, evaluateLlmJudgeCriterion, resolveTestRunStatus } from "../../runner/assertions.ts";
import type { IScenarioStepOutcome } from "../../runner/assertions.ts";
import { CriterionKind, CriterionPhase, CriterionStatus } from "../../schema/step_schema.ts";

async function runGit(cwd: string, args: string[]): Promise<void> {
  const output = await new Deno.Command("git", { args, cwd, stdout: "null", stderr: "piped" }).output();
  if (!output.success) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(output.stderr)}`);
  }
}

async function initRepoWithFix(
  repoDir: string,
  fileName: string,
  initialContent: string,
  fixedContent: string,
): Promise<void> {
  await Deno.mkdir(repoDir, { recursive: true });
  await Deno.writeTextFile(`${repoDir}/${fileName}`, initialContent);
  await runGit(repoDir, ["init", "-q"]);
  await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "add", "-A"]);
  await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
  await Deno.writeTextFile(`${repoDir}/${fileName}`, fixedContent);
  await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "add", "-A"]);
  await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "-q", "-m", "fix"]);
}

Deno.test("[JudgeDiffEvidence] a genuine fix produces a non-empty diff showing the added lines", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "judge-diff-evidence-" });
  try {
    const repoDir = `${workspaceRoot}/todo-app`;
    await initRepoWithFix(
      repoDir,
      "utils.ts",
      "export function f() { return x.y; }\n",
      'export function f() { if (!x) return ""; return x.y; }\n',
    );

    const diff = await computeGitDiffEvidence(workspaceRoot, "todo-app/utils.ts");
    assertStringIncludes(diff, "if (!x) return");
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[JudgeDiffEvidence] an uncommitted fix in the working tree is still captured, not silently reported as no changes", async () => {
  // A Haiku-solved trial left its correct fix uncommitted — diffing root..HEAD alone saw
  // nothing, since HEAD was still the init commit. Judging "(no changes)" against
  // genuinely-fixed-but-uncommitted code is exactly the failure the validity gate exists to catch.
  const workspaceRoot = await Deno.makeTempDir({ prefix: "judge-diff-evidence-uncommitted-" });
  try {
    const repoDir = `${workspaceRoot}/todo-app`;
    await Deno.mkdir(repoDir, { recursive: true });
    await Deno.writeTextFile(`${repoDir}/utils.ts`, "export function f() { return x.y; }\n");
    await runGit(repoDir, ["init", "-q"]);
    await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "add", "-A"]);
    await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
    // Fix applied but never committed — HEAD is still the init commit.
    await Deno.writeTextFile(`${repoDir}/utils.ts`, 'export function f() { if (!x) return ""; return x.y; }\n');

    const diff = await computeGitDiffEvidence(workspaceRoot, "todo-app/utils.ts");
    assertStringIncludes(diff, "if (!x) return");
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[JudgeDiffEvidence] no changes since the root commit is reported explicitly, not as an empty/ambiguous string", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "judge-diff-evidence-nochange-" });
  try {
    const repoDir = `${workspaceRoot}/todo-app`;
    // A single commit only: root commit == HEAD, so a diff between them is trivially empty —
    // exercises the "nothing changed" path without a redundant no-op second commit.
    await Deno.mkdir(repoDir, { recursive: true });
    await Deno.writeTextFile(`${repoDir}/utils.ts`, "export function f() { return x.y; }\n");
    await runGit(repoDir, ["init", "-q"]);
    await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "add", "-A"]);
    await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "-q", "-m", "init"]);

    const diff = await computeGitDiffEvidence(workspaceRoot, "todo-app/utils.ts");
    assertStringIncludes(diff, "no changes");
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[JudgeDiffEvidence] the diff is scoped to the requested file, not the whole repo", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "judge-diff-evidence-scope-" });
  try {
    const repoDir = `${workspaceRoot}/todo-app`;
    await Deno.mkdir(repoDir, { recursive: true });
    await Deno.writeTextFile(`${repoDir}/utils.ts`, "a\n");
    await Deno.writeTextFile(`${repoDir}/other.ts`, "b\n");
    await runGit(repoDir, ["init", "-q"]);
    await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "add", "-A"]);
    await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
    await Deno.writeTextFile(`${repoDir}/utils.ts`, "a-changed\n");
    await Deno.writeTextFile(`${repoDir}/other.ts`, "b-changed\n");
    await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "add", "-A"]);
    await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "-q", "-m", "fix"]);

    const diff = await computeGitDiffEvidence(workspaceRoot, "todo-app/utils.ts");
    assertStringIncludes(diff, "a-changed");
    assertEquals(diff.includes("other.ts"), false);
    assertEquals(diff.includes("b-changed"), false);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[JudgeDiffEvidence] whole-branch mode diffs EVERY applied change in the repo", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "judge-diff-evidence-branch-" });
  try {
    const repoDir = `${workspaceRoot}/todo-app`;
    await Deno.mkdir(repoDir, { recursive: true });
    await Deno.writeTextFile(`${repoDir}/utils.ts`, "a\n");
    await Deno.writeTextFile(`${repoDir}/storage.ts`, "b\n");
    await runGit(repoDir, ["init", "-q"]);
    await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "add", "-A"]);
    await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
    await Deno.writeTextFile(`${repoDir}/utils.ts`, "a-changed\n");
    await Deno.writeTextFile(`${repoDir}/storage.ts`, "b-changed\n");
    await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "add", "-A"]);
    await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "-q", "-m", "fix"]);

    const diff = await computeGitDiffEvidence(workspaceRoot, "todo-app", true);
    assertStringIncludes(diff, "a-changed");
    assertStringIncludes(diff, "b-changed");
    assertStringIncludes(diff, "utils.ts");
    assertStringIncludes(diff, "storage.ts");
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[JudgeDiffEvidence] a git-diff judge records the diff dir as evidence and captures reasoning", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "judge-diff-evidence-err-" });
  try {
    const repoDir = `${workspaceRoot}/todo-app`;
    await Deno.mkdir(repoDir, { recursive: true });
    await Deno.writeTextFile(`${repoDir}/storage.ts`, "a\n");
    await runGit(repoDir, ["init", "-q"]);
    await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "add", "-A"]);
    await runGit(repoDir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
    await Deno.writeTextFile(`${repoDir}/storage.ts`, "a-changed\n");
    const result = await evaluateLlmJudgeCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "llm-judge-quality",
        kind: CriterionKind.LLM_JUDGE,
        preset: "task_fulfillment",
        evidence_diff_dir: "todo-app",
        context_path: "reference.patch",
        score_threshold: 0.7,
      },
      env: {
        EXA_EVAL_LLM_MOCK: "pass",
        EXA_LLM_PROVIDER: "claude-cli",
        EXA_LLM_MODEL: "claude-cli:claude-sonnet-5",
      },
    });
    assertEquals(result.evidence_refs, ["todo-app"], "the diff dir is the recorded evidence");
    assertEquals(result.judge?.provider, "claude-cli");
    assertStringIncludes(result.judge?.reasoning ?? "", "mock pass");
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

function testOutcome(stepId: string, status: CriterionStatus, exitCode: number, output: string): IScenarioStepOutcome {
  return {
    stepId,
    status,
    failureStage: status === CriterionStatus.PASSED ? null : "execution",
    criterionResults: [],
    executionResult: {
      stepId,
      stepType: "test-run",
      startedAt: "",
      completedAt: "",
      durationMs: 0,
      exitCode,
      stdout: output,
      stderr: "",
      combinedOutput: output,
    },
  } as IScenarioStepOutcome;
}

Deno.test("[JudgeDiffEvidence] test_run_source passes a FAILED test run to the judge as context", () => {
  const status = resolveTestRunStatus("verify-tests", [
    testOutcome("verify-tests", CriterionStatus.FAILED, 1, "FAILED | 16 passed | 1 failed"),
  ]);
  assertStringIncludes(status ?? "", "FAILED");
  assertStringIncludes(status ?? "", "exit code 1");
  assertStringIncludes(status ?? "", "16 passed | 1 failed");
});

Deno.test("[JudgeDiffEvidence] test_run_source passes a PASSED test run and tolerates a missing step", () => {
  const passed = resolveTestRunStatus("verify-tests", [
    testOutcome("verify-tests", CriterionStatus.PASSED, 0, "ok | 17 passed"),
  ]);
  assertStringIncludes(passed ?? "", "PASSED");
  assertEquals(resolveTestRunStatus("verify-tests", undefined), undefined);
  assertEquals(resolveTestRunStatus("missing", [testOutcome("other", CriterionStatus.PASSED, 0, "x")]), undefined);
});
