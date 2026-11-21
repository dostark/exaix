#!/usr/bin/env -S deno run -A
/**
 * @module GoPortPreserveSnapshot
 * @path scripts/go_port/preserve_snapshot.ts
 * @description Clones the recorded baseline outside the repository, runs check and one smoke scenario, and records the result.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [exaix-dev-docs/evidence/go-port/snapshot_manifest.json, exaix-dev-docs/completed/phase-245-go-port-prerequisites.md]
 *
 * Usage:
 *   deno run -A scripts/go_port/preserve_snapshot.ts [--manifest=<path>] [--target=<dir>] [--skip-check] [--skip-smoke]
 */

import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, resolve, SEPARATOR } from "@std/path";
import { argValue } from "./cli_args.ts";

/** The refs a snapshot must check out. */
interface IManifestRefs {
  readonly parent: string;
  readonly submodules: Readonly<Record<string, string>>;
}

/** The command the snapshot runner records. */
interface ICommandRecord {
  readonly command: readonly string[];
  readonly exit_code: number;
  readonly duration_ms: number;
}

/** The environment that binds scenario execution to the snapshot. */
interface ISnapshotEnv {
  readonly EXA_BIN_PATH: string;
  readonly EXA_DAEMON_SCRIPT: string;
}

const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), "..", ".."));
const DEFAULT_MANIFEST = join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "snapshot_manifest.json");
const DEFAULT_TARGET = join(dirname(REPO_ROOT), "exaix-sandboxes", "phase-245-snapshot");
const SHA = /^[0-9a-f]{40}$/;
const SMOKE_SCENARIO = "framework-smoke-validation";

/** Refuses a target inside the repository or one that resolves through a symlink into it. */
export async function assertTargetAllowed(repoRoot: string, target: string): Promise<void> {
  const repo = await Deno.realPath(repoRoot);
  const absolute = resolve(target);
  let real = absolute;
  try {
    real = await Deno.realPath(absolute);
  } catch {
    const parent = await Deno.realPath(dirname(absolute)).catch(() => dirname(absolute));
    real = join(parent, absolute.slice(dirname(absolute).length).replace(/^[/\\]+/, ""));
  }
  if (real === repo || real.startsWith(`${repo}${SEPARATOR}`)) {
    throw new Error(`snapshot target is inside the repository: ${absolute}`);
  }
}

/** Returns every missing or malformed ref. */
export function validateManifestRefs(refs: IManifestRefs): string[] {
  const errors: string[] = [];
  if (!SHA.test(refs.parent)) errors.push(`parent: '${refs.parent}' is not a full commit SHA`);
  for (const [path, sha] of Object.entries(refs.submodules)) {
    if (!SHA.test(sha)) errors.push(`submodule ${path}: '${sha}' is not a full commit SHA`);
  }
  return errors;
}

/** Clones the repository at the recorded parent and checks out every submodule SHA. */
export async function cloneSnapshot(refs: IManifestRefs, target: string, repoRoot: string): Promise<void> {
  await assertTargetAllowed(repoRoot, target);
  const before = await statusOf(repoRoot);
  await git(dirname(target), ["clone", "--shared", "--no-checkout", repoRoot, target]);
  await git(target, ["checkout", "--detach", refs.parent]);
  for (const [path, sha] of Object.entries(refs.submodules)) {
    const source = join(repoRoot, path);
    const destination = join(target, path);
    await Deno.remove(destination, { recursive: true }).catch(() => {});
    await Deno.mkdir(dirname(destination), { recursive: true });
    await git(dirname(destination), ["clone", "--shared", "--no-checkout", source, destination]);
    await git(destination, ["checkout", "--detach", sha]);
  }
  const after = await statusOf(repoRoot);
  if (before !== after) throw new Error("source worktree changed while cloning the snapshot");
}

export async function gitOutput(cwd: string, args: readonly string[]): Promise<string> {
  const result = await new Deno.Command("git", {
    args: [...args],
    cwd,
    env: { LD_LIBRARY_PATH: "" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr).trim() || `git ${args[0]} failed`);
  return new TextDecoder().decode(result.stdout).trim();
}

async function statusOf(cwd: string): Promise<string> {
  return await gitOutput(cwd, ["status", "--porcelain"]);
}

/** The two recorded smoke verdicts. */
type TVerdict = "pass" | "fail";

/** The snapshot's own CLI and daemon paths. */
export function snapshotCli(
  snapshot: string,
): { readonly bin: string; readonly exactl: string; readonly daemon: string } {
  const bin = join(snapshot, "tests", "scenario_framework", "bin");
  return {
    bin,
    exactl: join(bin, "exactl"),
    daemon: join(snapshot, "apps", "daemon", "main.ts"),
  };
}

/** Refuses a snapshot whose own CLI is missing or resolves outside the snapshot. */
export async function assertSnapshotCli(snapshot: string): Promise<void> {
  const cli = snapshotCli(snapshot);
  const realSnapshot = await Deno.realPath(snapshot);
  const realExactl = await Deno.realPath(cli.exactl);
  if (!realExactl.startsWith(`${realSnapshot}${SEPARATOR}`)) {
    throw new Error(`snapshot exactl resolves outside the snapshot: ${realExactl}`);
  }
}

/** Reads the scenario outcome and returns the recorded verdict. */
export function smokeVerdict(raw: { readonly outcome?: string }): TVerdict {
  if (raw.outcome === undefined || raw.outcome === "") {
    throw new Error("smoke run manifest has no outcome");
  }
  return raw.outcome === "success" ? "pass" : "fail";
}

/** The environment that makes the scenario runner use the snapshot's own CLI and daemon. */
export function snapshotEnv(snapshot: string): ISnapshotEnv {
  return {
    EXA_BIN_PATH: snapshotCli(snapshot).bin,
    EXA_DAEMON_SCRIPT: snapshotCli(snapshot).daemon,
  };
}

async function hashTree(root: string): Promise<string> {
  const rows: string[] = [];
  for await (const entry of walk(root, { includeDirs: false })) {
    const relative = entry.path.slice(root.length + 1);
    const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(entry.path));
    rows.push(`${relative}:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`);
  }
  rows.sort();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rows.join("\n")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function git(cwd: string, args: readonly string[]): Promise<void> {
  const result = await new Deno.Command("git", {
    args: [...args],
    cwd,
    env: { LD_LIBRARY_PATH: "" },
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

async function run(command: readonly string[], cwd: string, env: Record<string, string> = {}): Promise<ICommandRecord> {
  const start = performance.now();
  const result = await new Deno.Command(command[0], {
    args: [...command.slice(1)],
    cwd,
    env: { ...Deno.env.toObject(), ...env },
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) throw new Error(`${command.join(" ")} exited ${result.code}`);
  return { command, exit_code: result.code, duration_ms: Math.round(performance.now() - start) };
}

async function main(args: readonly string[]): Promise<number> {
  const manifestPath = argValue(args, "manifest") ?? DEFAULT_MANIFEST;
  const target = resolve(argValue(args, "target") ?? DEFAULT_TARGET);
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath)) as {
    content_hash: string;
    parent: string;
    submodules: Readonly<Record<string, string>>;
  };
  const errors = validateManifestRefs(manifest);
  if (errors.length > 0) {
    for (const error of errors) console.error(`❌ ${error}`);
    return 1;
  }
  await Deno.remove(target, { recursive: true }).catch(() => {});
  await cloneSnapshot(manifest, target, REPO_ROOT);
  await assertSnapshotCli(target);
  const commands: ICommandRecord[] = [];
  if (!args.includes("--skip-check")) commands.push(await run(["deno", "task", "check"], target));
  let smoke: { id: string; verdict: string; exit_code: number; evidence_hash: string } | null = null;
  if (!args.includes("--skip-smoke")) {
    const record = await run(
      [
        "deno",
        "run",
        "-A",
        "tests/scenario_framework/runner/main.ts",
        "--profile",
        "ci-smoke",
        "--scenario",
        SMOKE_SCENARIO,
        "--output",
        join(target, "evidence"),
      ],
      target,
      { EXA_LLM_PROVIDER: "mock", ...snapshotEnv(target) },
    );
    commands.push(record);
    const manifestRecord = JSON.parse(
      await Deno.readTextFile(join(target, "evidence", "run-manifest.json")),
    ) as { readonly outcome?: string };
    smoke = {
      id: SMOKE_SCENARIO,
      verdict: smokeVerdict(manifestRecord),
      exit_code: record.exit_code,
      evidence_hash: await hashTree(join(target, "evidence")),
    };
  }
  const evidence = {
    manifest_hash: manifest.content_hash,
    snapshot_path: target,
    commands,
    smoke,
  };
  const output = join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "snapshot_run.json");
  await Deno.mkdir(dirname(output), { recursive: true });
  await Deno.writeTextFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`✅ snapshot ${target}`);
  return smoke === null || smoke.verdict === "pass" ? 0 : 1;
}

if (import.meta.main) Deno.exit(await main(Deno.args));
