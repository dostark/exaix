#!/usr/bin/env -S deno run -A
/**
 * @module CommitPlanStep
 * @path scripts/commit_plan_step.ts
 * @description Commits staged plan changes and child trees before recording their gitlinks in the parent.
 * Usage: deno run -A scripts/commit_plan_step.ts <message-file> [--commit]
 * @architectural-layer Tooling
 * @dependencies [scripts/check_commit_msg.ts, scripts/plan_git.ts]
 */

import { resolve } from "@std/path";
import { parsePlanField, resolveOwningRepo } from "./check_commit_msg.ts";
import { gitlink, GO_BOOTSTRAP, PLAN_CODE_SUBMODULES, readGit } from "./plan_git.ts";

interface IChild {
  path: string;
  branch: string;
  base: string;
  tree: string;
  pointer: string;
  result: string;
}

interface IReceipt {
  branch: string;
  base: string;
  tree: string;
  message: string;
  children: IChild[];
}

const head = (cwd: string): Promise<string> => readGit(["rev-parse", "HEAD"], cwd);
const branch = (cwd: string): Promise<string> => readGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
const indexTree = (cwd: string): Promise<string> => readGit(["write-tree"], cwd);

async function prepare(message: string, docPath: string): Promise<IReceipt> {
  const doc = await resolveOwningRepo(docPath);
  const docDiff = await readGit(["diff", "--cached", "--unified=0", "--", doc.relPath], doc.submodule);
  if (!docDiff.split("\n").some((line) => line.startsWith("+") && !line.startsWith("+++"))) {
    throw new Error(`No plan changes staged for ${docPath}`);
  }
  const children: IChild[] = [];
  const paths = new Set([doc.submodule, ...PLAN_CODE_SUBMODULES]);
  for (const path of paths) {
    if (!path || !await gitlink(path, true)) continue;
    const status = await readGit(["submodule", "status", "--", path]);
    if (status.startsWith("-")) continue;
    const pointer = await gitlink(path, true);
    const base = await head(path);
    const previous = await gitlink(path, false) || (path === "exaix-go" ? GO_BOOTSTRAP : "");
    if (base !== pointer || pointer !== previous) throw new Error(`Unexpected base or staged pointer in ${path}`);
    await checkWorktree(path);
    const tree = await indexTree(path);
    if (tree !== await readGit(["rev-parse", "HEAD^{tree}"], path)) {
      children.push({ path, base, branch: await branch(path), tree, pointer, result: "" });
    }
  }
  return { message, base: await head("."), tree: await indexTree("."), branch: await branch("."), children };
}

async function checkWorktree(path: string): Promise<void> {
  const changed = await readGit(["diff", "--name-only", "-z"], path);
  const untracked = await readGit(["ls-files", "--others", "--exclude-standard", "-z"], path);
  if (changed || untracked) throw new Error(`Unstaged changes in ${path}`);
}

async function verify(receipt: IReceipt): Promise<void> {
  if (await head(".") !== receipt.base || await branch(".") !== receipt.branch) throw new Error("Parent base changed");
  const excludes = receipt.children.map((child) => `:(exclude,literal)${child.path}`);
  const changes = await readGit(["diff", "--cached", "--name-only", "-z", receipt.tree, "--", ".", ...excludes]);
  if (changes) throw new Error("Parent staged content changed since preflight");
  for (const child of receipt.children) {
    await checkWorktree(child.path);
    if (await branch(child.path) !== child.branch || await indexTree(child.path) !== child.tree) {
      throw new Error(`Child branch or staged content changed in ${child.path}`);
    }
    if (
      child.result && (await readGit(["rev-parse", `${child.result}^`], child.path) !== child.base ||
        await readGit(["rev-parse", `${child.result}^{tree}`], child.path) !== child.tree)
    ) {
      throw new Error(`Committed child differs from its staged input in ${child.path}`);
    }
    const current = await head(child.path);
    if (current !== (child.result || child.base) || await gitlink(child.path, true) !== child.pointer) {
      throw new Error(`Child revision or staged pointer changed in ${child.path}`);
    }
  }
}

async function save(path: string, receipt: IReceipt): Promise<void> {
  await Deno.writeTextFile(path + ".new", JSON.stringify(receipt));
  await Deno.rename(path + ".new", path);
}

async function commit(messageFile: string, cwd: string): Promise<void> {
  const { success } = await new Deno.Command("git", {
    args: ["-C", cwd, "commit", "-F", messageFile],
    env: { LD_LIBRARY_PATH: "" },
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!success) throw new Error(`Commit rejected in ${cwd}. Fix the hook failure and retry the same message.`);
}

async function run(messageFile: string, apply: boolean): Promise<void> {
  const message = await Deno.readTextFile(messageFile);
  const ref = parsePlanField(message);
  if (!ref) throw new Error("A plan-step commit requires a plan: field");
  const path = await readGit(["rev-parse", "--git-path", "plan-step-receipt.json"]);
  using lock = await Deno.open(path + ".lock", { read: true, write: true, create: true });
  await lock.lock(true);
  let receipt: IReceipt;
  try {
    receipt = JSON.parse(await Deno.readTextFile(path));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    receipt = await prepare(message, ref.docPath);
  }
  if (receipt.message !== message) throw new Error("A different plan-step commit is pending");
  await verify(receipt);
  if (!apply) {
    console.log("Plan-step preflight passed.");
    return;
  }
  await save(path, receipt);
  for (const child of receipt.children) {
    if (!child.result) {
      await commit(messageFile, child.path);
      child.result = await head(child.path);
      await save(path, receipt);
      if (
        await readGit(["rev-parse", "HEAD^"], child.path) !== child.base ||
        await readGit(["rev-parse", "HEAD^{tree}"], child.path) !== child.tree
      ) {
        throw new Error(`Committed child differs from its staged input in ${child.path}`);
      }
    }
    if (child.pointer !== child.result) {
      await readGit(["update-index", "--cacheinfo", `160000,${child.result},${child.path}`]);
      child.pointer = child.result;
      await save(path, receipt);
    }
  }
  await verify(receipt);
  await commit(messageFile, ".");
  console.log(`Parent ${receipt.base} -> ${await head(".")}`);
  for (const child of receipt.children) console.log(`${child.path} ${child.base} -> ${child.result}`);
  await Deno.remove(path);
}

if (import.meta.main) {
  try {
    if (!Deno.args[0]) throw new Error("Supply the plan-step message file");
    await run(resolve(Deno.args[0]), Deno.args.includes("--commit"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
