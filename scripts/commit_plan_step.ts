#!/usr/bin/env -S deno run -A
/**
 * @module CommitPlanStep
 * @path scripts/commit_plan_step.ts
 * @description Orchestrates a plan-step commit that spans the parent repo AND the
 *   exaix-dev-docs submodule (where phase plan docs live). It stages nothing itself —
 *   it reads what is ALREADY STAGED in both repos, verifies cross-repo consistency (the
 *   plan doc's ✅/deferred step lines are staged in the submodule; the parent's staged
 *   pointer will match after the submodule commit; the ✅ → paths are staged in the
 *   parent), and only then performs the two commits (submodule first, then the parent
 *   pointer bump) — keeping the phase file and the parent in sync.
 *
 *   Validation reuses the pure functions in check_commit_msg.ts. Git plumbing lives here.
 *
 * Usage:
 *   deno run -A scripts/commit_plan_step.ts <commit-msg-file>            # validate only (default)
 *   deno run -A scripts/commit_plan_step.ts <commit-msg-file> --commit   # validate then commit both
 *
 * @architectural-layer Tooling
 * @dependencies [scripts/check_commit_msg.ts]
 * @related-files [scripts/check_commit_msg.ts, .claude/skills/submodule-workflow/SKILL.md]
 */

import {
  type IPlanRef,
  parseLedgerSymbols,
  parsePlanField,
  parsePlanStep,
  type PlanSyncStatus,
  validateCommitMsg,
  validatePlanStepDiff,
} from "./check_commit_msg.ts";

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

/** The configured submodule paths (from .gitmodules), longest-first for prefix matching. */
async function submodulePaths(): Promise<string[]> {
  const raw = await git(["config", "--file", ".gitmodules", "--get-regexp", "path"]);
  return raw
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[1])
    .filter((p): p is string => Boolean(p))
    .sort((a, b) => b.length - a.length);
}

/** Owning repo of a plan doc path: the submodule dir + in-submodule path, or the parent. */
interface IOwningRepo {
  submodule?: string; // e.g. "exaix-dev-docs"
  relPath: string; // path relative to the owning repo root
}

async function resolveOwningRepo(docPath: string): Promise<IOwningRepo> {
  for (const sub of await submodulePaths()) {
    if (docPath === sub || docPath.startsWith(`${sub}/`)) {
      return { submodule: sub, relPath: docPath.slice(sub.length).replace(/^\//, "") };
    }
  }
  return { relPath: docPath };
}

/** Added lines (`+` stripped, trimmed) of the plan doc's STAGED diff in its owning repo. */
async function stagedAddedLines(repo: IOwningRepo): Promise<string[]> {
  const cwd = repo.submodule;
  const diff = await git(["diff", "--cached", "--unified=0", "--", repo.relPath], cwd);
  return diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1).trim())
    .filter((l) => l.length > 0);
}

/** Parent-repo staged changed files (repo-root-relative). */
async function parentStagedFiles(): Promise<string[]> {
  const raw = await git(["diff", "--cached", "--name-only"]);
  return raw ? raw.split("\n").map((f) => f.trim()).filter(Boolean) : [];
}

/**
 * Sync status: does the submodule have the plan-doc changes staged AND will the parent's
 * pointer end up matching the submodule HEAD after committing?
 * - in_sync:   the plan doc is staged in the submodule and the submodule is clean-to-commit.
 * - out_of_sync: nothing staged for the plan doc (e.g. it was committed separately already,
 *   violating the commit-together workflow) → caller instructs a submodule rollback.
 * - unknown:   the owning repo/diff could not be resolved.
 */
async function resolveSync(repo: IOwningRepo, addedLines: string[]): Promise<PlanSyncStatus> {
  if (repo.submodule) {
    // Confirm the submodule dir is a real checked-out git repo.
    const head = await git(["rev-parse", "HEAD"], repo.submodule);
    if (!head) return "unknown";
    // The plan doc must be staged in the submodule now (commit-together workflow).
    return addedLines.length > 0 ? "in_sync" : "out_of_sync";
  }
  // Parent-owned plan doc: staged changes are visible directly.
  return addedLines.length > 0 ? "in_sync" : "out_of_sync";
}

interface IResolved {
  planRef: IPlanRef;
  repo: IOwningRepo;
  addedLines: string[];
  sync: PlanSyncStatus;
  parentFiles: string[];
  docText: string;
}

async function resolve(planRef: IPlanRef): Promise<IResolved | { error: string }> {
  const repo = await resolveOwningRepo(planRef.docPath);
  let docText: string;
  try {
    docText = Deno.readTextFileSync(planRef.docPath);
  } catch (_e) {
    return { error: `plan doc "${planRef.docPath}" could not be read (repo-root-relative + checked out?).` };
  }
  const addedLines = await stagedAddedLines(repo);
  const sync = await resolveSync(repo, addedLines);
  const parentFiles = await parentStagedFiles();
  return { planRef, repo, addedLines, sync, parentFiles, docText };
}

/** Validate the whole plan-step commit; returns the collected error list ([] = ok). */
function validateAll(text: string, r: IResolved): string[] {
  const parsed = parsePlanStep(r.docText, r.planRef.step);

  // 1. Structural + traceability (paths in changed files, ledger, backticks, no [ ]).
  const msg = validateCommitMsg(text, {
    changedFileCount: r.parentFiles.length,
    planValidation: {
      criteriaPaths: parsed.criteriaPaths,
      testPaths: parsed.testPaths,
      planErrors: parsed.errors,
      changedFiles: r.parentFiles,
      deferredTokens: parsed.deferredTokens,
      ledgerSymbols: parseLedgerSymbols(r.docText),
    },
  });

  // 2. Cross-repo diff consistency: item lines are added diff lines + pointer in sync.
  const diff = validatePlanStepDiff(parsed.itemLines, r.addedLines, r.sync);

  return [...msg.errors, ...diff.errors];
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

  const errors = validateAll(text, r);
  if (errors.length > 0) {
    console.error("\n❌ Plan-step commit blocked:");
    errors.forEach((e) => console.error(`  - ${e}`));
    Deno.exit(1);
  }

  console.log("✅ Plan-step consistency validated (plan lines staged, paths staged, in sync).");
  if (!doCommit) {
    console.log("   (validate-only — pass --commit to perform the submodule + parent commits)");
    Deno.exit(0);
  }

  const ok = await performCommits(msgFile, r.repo);
  Deno.exit(ok ? 0 : 1);
}
