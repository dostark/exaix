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
import { computeGitDiffEvidence } from "../../runner/assertions.ts";

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
