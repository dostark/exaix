#!/usr/bin/env -S deno run -A
/**
 * @module CommitPlanStep
 * @path scripts/commit_plan_step.ts
 * @description Convenience orchestrator for a plan-step commit that spans the parent repo
 *   AND the exaix-dev-docs submodule (where phase plan docs live). It stages nothing —
 *   it pre-flights that the plan doc's ✅/deferred lines are staged in their owning repo
 *   (failing fast before touching git), then performs the two commits (submodule first,
 *   then the parent pointer bump). The AUTHORITATIVE plan-step gate (paths + ledger +
 *   backticks + no `[ ]` + item-lines-in-plan-diff + submodule/parent sync) runs in the
 *   parent commit-msg hook via check_commit_msg.ts, so a plain `git commit` is enforced
 *   too — this script just avoids the submodule-committed-then-parent-blocked footgun and
 *   automates the two-repo commit sequence.
 *
 * Usage:
 *   deno run -A scripts/commit_plan_step.ts <commit-msg-file>            # validate only (default)
 *   deno run -A scripts/commit_plan_step.ts <commit-msg-file> --commit   # validate then commit both
 *
 * @architectural-layer Tooling
 * @dependencies [scripts/check_commit_msg.ts]
 * @related-files [scripts/check_commit_msg.ts, .claude/skills/submodule-workflow/SKILL.md]
 */

import { type IOwningRepo, type IPlanRef, parsePlanField, resolveOwningRepo } from "./check_commit_msg.ts";

/** Run a git command in `cwd`; return trimmed stdout (empty on failure). */
async function git(args: string[], cwd?: string): Promise<string> {
  try {
    const out = await new Deno.Command("git", {
      args: cwd ? ["-C", cwd, ...args] : args,
      stdout: "piped",
      stderr: "null",
    }).output();
    return out.success ? new TextDecoder().decode(out.stdout).trim() : "";
  } catch (_e) {
    return "";
  }
}

/** Added lines (`+` stripped, trimmed) of the plan doc's STAGED diff in its owning repo. */
async function stagedAddedLines(repo: IOwningRepo): Promise<string[]> {
  const diff = await git(["diff", "--cached", "--unified=0", "--", repo.relPath], repo.submodule);
  return diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1).trim())
    .filter((l) => l.length > 0);
}

interface IResolved {
  planRef: IPlanRef;
  repo: IOwningRepo;
  stagedPlanLines: string[];
}

async function resolve(planRef: IPlanRef): Promise<IResolved | { error: string }> {
  const repo = await resolveOwningRepo(planRef.docPath);
  try {
    Deno.readTextFileSync(planRef.docPath);
  } catch (_e) {
    return { error: `plan doc "${planRef.docPath}" could not be read (repo-root-relative + checked out?).` };
  }
  const stagedPlanLines = await stagedAddedLines(repo);
  return { planRef, repo, stagedPlanLines };
}

/**
 * Pre-flight the plan-step commit before touching git. The authoritative validation is the
 * parent commit-msg hook (which runs the full gate via check_commit_msg.ts, including the
 * staged ∪ last-commit diff facet); this pre-flight just fails fast on the obvious
 * commit-together violation — the plan doc's ✅/deferred lines are not staged in its owning
 * repo — so we never commit the submodule and then get blocked at the parent.
 */
function preflightErrors(r: IResolved): string[] {
  if (r.stagedPlanLines.length === 0) {
    return [
      `Plan sync: no plan-doc changes are staged in ${
        r.repo.submodule ? `submodule "${r.repo.submodule}"` : "the repo"
      } — stage the step's ✅/deferred lines (git ${
        r.repo.submodule ? `-C ${r.repo.submodule} ` : ""
      }add ${r.repo.relPath}) so they land together with the parent code. If you already ` +
      `committed the submodule separately, roll it back: git -C ${r.repo.submodule ?? "."} reset --soft HEAD~1.`,
    ];
  }
  return [];
}

/** Commit the submodule (if any) then the parent pointer + code, using the same message. */
async function performCommits(msgFile: string, repo: IOwningRepo): Promise<boolean> {
  if (repo.submodule) {
    const subCommit = await runGitInherit(["commit", "-F", msgFile], repo.submodule);
    if (!subCommit) return false;
    // Stage the pointer bump in the parent so it matches the new submodule HEAD.
    const staged = await runGitInherit(["add", repo.submodule]);
    if (!staged) return false;
  }
  return await runGitInherit(["commit", "-F", msgFile]);
}

/** Run git with inherited stdio (so hooks/output show); return success. */
async function runGitInherit(args: string[], cwd?: string): Promise<boolean> {
  const out = await new Deno.Command("git", {
    args: cwd ? ["-C", cwd, ...args] : args,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  return out.success;
}

if (import.meta.main) {
  const msgFile = Deno.args[0];
  const doCommit = Deno.args.includes("--commit");
  if (!msgFile) {
    console.error("Usage: deno run -A scripts/commit_plan_step.ts <commit-msg-file> [--commit]");
    Deno.exit(1);
  }

  const text = Deno.readTextFileSync(msgFile);
  const planRef = parsePlanField(text);
  if (!planRef) {
    console.error("No `plan:` field in the commit message — commit_plan_step is only for plan-step commits.");
    Deno.exit(1);
  }

  const r = await resolve(planRef);
  if ("error" in r) {
    console.error(`\n❌ Plan-step commit blocked:\n  - ${r.error}`);
    Deno.exit(1);
  }

  // Fail fast on the commit-together violation before touching git. The FULL plan-step
  // gate (paths + ledger + backticks + no [ ] + diff-lines + sync) runs authoritatively in
  // the parent commit-msg hook (check_commit_msg.ts) — this pre-flight just avoids
  // committing the submodule and then getting blocked at the parent.
  const errors = preflightErrors(r);
  if (errors.length > 0) {
    console.error("\n❌ Plan-step commit blocked:");
    errors.forEach((e) => console.error(`  - ${e}`));
    Deno.exit(1);
  }

  console.log("✅ Plan-step pre-flight OK (plan lines staged in the owning repo).");
  if (!doCommit) {
    console.log("   (validate-only — pass --commit to perform the submodule + parent commits;");
    console.log("    the parent commit-msg hook runs the full plan-step gate.)");
    Deno.exit(0);
  }

  const ok = await performCommits(msgFile, r.repo);
  Deno.exit(ok ? 0 : 1);
}
