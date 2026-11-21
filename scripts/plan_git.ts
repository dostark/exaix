#!/usr/bin/env -S deno run -A
/**
 * @module PlanGit
 * @path scripts/plan_git.ts
 * @description Reads the Git index and child repositories used by plan-step commits.
 * Usage: imported by the commit hook and plan-step orchestrator.
 */

export const PLAN_CODE_SUBMODULES = ["unslop-ts", "exaix-team", "exaix-enterprise", "exaix-go"];
export const GO_BOOTSTRAP = "8257d6b690ac6b8b698606948691eac4a6672d27";

const HOOK_VARIABLES = [
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_WORK_TREE",
  "GIT_PREFIX",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];

/** Keep the parent hook index. Remove parent repository overrides only for child commands. */
export async function readGit(args: string[], cwd = "."): Promise<string> {
  const unset = cwd === "." ? [] : HOOK_VARIABLES;
  // Clear only the inherited repository context for the child process.
  const saved = new Map<string, string>();
  for (const key of unset) {
    const value = Deno.env.get(key);
    if (value !== undefined) {
      saved.set(key, value);
      Deno.env.delete(key);
    }
  }
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command("git", {
      args: ["-C", cwd, ...args],
      env: { LD_LIBRARY_PATH: "" },
      stdout: "piped",
      stderr: "piped",
    }).spawn();
  } finally {
    for (const [key, value] of saved) Deno.env.set(key, value);
  }
  const result = await child.output();
  const decoder = new TextDecoder();
  if (!result.success) throw new Error(decoder.decode(result.stderr).trim() || `git ${args[0]} failed in ${cwd}`);
  return decoder.decode(result.stdout).trimEnd();
}

/** Return the gitlink from the parent tree or index. Reject conflicts and ordinary files. */
export async function gitlink(path: string, staged: boolean): Promise<string> {
  const row = await readGit(staged ? ["ls-files", "--stage", "--", path] : ["ls-tree", "HEAD", "--", path]);
  if (!row) return "";
  const match = staged ? /^160000 ([0-9a-f]+) 0\t/ : /^160000 commit ([0-9a-f]+)\t/;
  const sha = row.match(match)?.[1];
  if (!sha || row.split("\t")[1] !== path) throw new Error(`Invalid gitlink for ${path}`);
  return sha;
}

/** Read changed paths that still exist in the staged child revision. */
export async function changedChildFiles(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const sub of PLAN_CODE_SUBMODULES.filter((path) => paths.includes(path))) {
    const tip = await gitlink(sub, true);
    const base = await gitlink(sub, false) || (sub === "exaix-go" ? GO_BOOTSTRAP : "");
    if (!tip || base === tip) continue;
    if (!base) throw new Error(`Missing bootstrap revision for ${sub}`);
    const names = await readGit(["diff", "--no-renames", "--diff-filter=AMT", "--name-only", "-z", base, tip], sub);
    files.push(...names.split("\0").filter(Boolean).map((name) => `${sub}/${name}`));
  }
  return files;
}
