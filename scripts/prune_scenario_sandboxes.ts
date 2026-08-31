#!/usr/bin/env -S deno run -A
/**
 * @module PruneScenarioSandboxes
 * @path scripts/prune_scenario_sandboxes.ts
 * @description Phase 142 Step 16 — reclaim the backlog of scenario sandboxes already on disk.
 *   Dry-run by default; `--apply` removes.
 *
 * Usage:
 *   deno task scenario:prune                  # dry run, 7-day window
 *   deno task scenario:prune --days 14
 *   deno task scenario:prune --days 0 --apply # remove, all ages
 *   deno task scenario:prune --root <path>    # override the sandbox root
 *
 * @architectural-layer Script
 * @related-files [tests/scenario_framework/runner/sandbox_lifecycle.ts, tests/scripts/prune_scenario_sandboxes_test.ts]
 *
 * Cleanup-on-success (see `sandbox_lifecycle.ts`) only helps runs from now on. 103 sandboxes
 * totalling 407 MB predate it on one development machine, and a CI runner accumulates them until
 * the disk fills — presenting as an unrelated build failure. This is the documented command for
 * that, and the one a periodic CI job would call.
 *
 * Dry-run by default because the alternative an operator reaches for is
 * `rm -rf <base>/exaix-sandboxes/*`, which is how someone eventually deletes the wrong directory;
 * printing the plan first makes the destructive form a deliberate second step.
 *
 * Selection is by modification time, not by parsing the run-id. The id carries a base-36 timestamp
 * prefix that could drift with any change to how run-ids are minted, whereas mtime is directly the
 * property being asserted: nothing has touched this in N days.
 */

import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { parse as parseArgs } from "@std/flags";

export interface IPlanSandboxPruneOptions {
  root: string;
  retentionDays: number;
}

export interface IPrunableSandbox {
  name: string;
  path: string;
  ageDays: number;
  bytes: number;
}

export interface ISandboxPrunePlan {
  root: string;
  retentionDays: number;
  selected: IPrunableSandbox[];
  totalBytes: number;
}

/** Mirrors `config.ts`: the sandbox base is `EXA_SANDBOX_BASE`, else the repo's parent directory. */
const SANDBOX_BASE_ENV = "EXA_SANDBOX_BASE";
const SANDBOX_DIR_NAME = "exaix-sandboxes";
const DEFAULT_RETENTION_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BYTES_PER_MB = 1024 * 1024;

/** The default sandbox root, resolved the same way the runner resolves it. */
export function defaultSandboxRoot(): string {
  const repoRoot = resolve(dirname(fromFileUrl(import.meta.url)), "..");
  const base = Deno.env.get(SANDBOX_BASE_ENV) ?? dirname(repoRoot);
  return join(resolve(base), SANDBOX_DIR_NAME);
}

// Entries whose presence at a directory's top level identifies it as a scenario sandbox.
// `exa.config.toml` and `.exa/` are written by every run; `output/` is what survives
// cleanup, so a reclaimed sandbox holding only that is still a valid prune candidate.
const SANDBOX_MARKERS = ["exa.config.toml", ".exa", "output"] as const;

async function hasEntry(path: string, name: string): Promise<boolean> {
  return await Deno.stat(join(path, name)).then(() => true).catch(() => false);
}

// Positively identify a sandbox rather than excluding things that are obviously not one:
// `--root` drives a recursive delete, so requiring a marker the runner itself writes makes
// a mistyped `--root` inert. The git check stays too, since a checkout could hold `output/`.
async function isPrunableSandbox(path: string): Promise<boolean> {
  if (await hasEntry(path, ".git")) return false;
  for (const marker of SANDBOX_MARKERS) {
    if (await hasEntry(path, marker)) return true;
  }
  return false;
}

async function directoryBytes(path: string): Promise<number> {
  let total = 0;
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(current));
    } catch {
      continue; // vanished mid-walk, or unreadable — it contributes nothing we can claim
    }
    for (const entry of entries) {
      const child = join(current, entry.name);
      if (entry.isDirectory) {
        stack.push(child);
        continue;
      }
      try {
        total += (await Deno.lstat(child)).size;
      } catch { /* same */ }
    }
  }
  return total;
}

// Compute what would be removed. Never removes anything — that is `applySandboxPrune`'s job.
// A missing root is an empty plan rather than an error: a machine that has never run a
// scenario has no sandbox root, and the periodic CI invocation must not fail there.
export async function planSandboxPrune(options: IPlanSandboxPruneOptions): Promise<ISandboxPrunePlan> {
  const root = resolve(options.root);
  const cutoff = Date.now() - options.retentionDays * MS_PER_DAY;
  const selected: IPrunableSandbox[] = [];

  let entries: Deno.DirEntry[];
  try {
    entries = await Array.fromAsync(Deno.readDir(root));
  } catch {
    return { root, retentionDays: options.retentionDays, selected: [], totalBytes: 0 };
  }

  for (const entry of entries) {
    // Only directories are sandboxes; a stray file beside them is not ours to remove.
    if (!entry.isDirectory) continue;
    const path = join(root, entry.name);
    if (!await isPrunableSandbox(path)) continue;
    const info = await Deno.stat(path).catch(() => null);
    const modified = info?.mtime?.getTime();
    if (modified === undefined || modified > cutoff) continue;
    selected.push({
      name: entry.name,
      path,
      ageDays: Math.floor((Date.now() - modified) / MS_PER_DAY),
      bytes: await directoryBytes(path),
    });
  }

  selected.sort((a, b) => b.ageDays - a.ageDays);
  return {
    root,
    retentionDays: options.retentionDays,
    selected,
    totalBytes: selected.reduce((sum, entry) => sum + entry.bytes, 0),
  };
}

export async function applySandboxPrune(plan: ISandboxPrunePlan): Promise<number> {
  let removed = 0;
  for (const entry of plan.selected) {
    try {
      await Deno.remove(entry.path, { recursive: true });
      removed += 1;
    } catch (error) {
      console.error(`  failed to remove ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return removed;
}

function formatMb(bytes: number): string {
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    boolean: ["apply", "help"],
    string: ["root", "days"],
    default: { apply: false, help: false },
  });

  if (args.help) {
    console.log(
      "Prune scenario sandboxes.\n\n" +
        "  --days <n>    retention window in days (default 7)\n" +
        "  --root <path> sandbox root (default: the runner's own resolution)\n" +
        "  --apply       actually remove; omit for a dry run\n",
    );
    return;
  }

  const retentionDays = args.days === undefined ? DEFAULT_RETENTION_DAYS : Number(args.days);
  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    console.error(`--days must be a non-negative number, got "${args.days}"`);
    Deno.exit(2);
  }

  const plan = await planSandboxPrune({ root: args.root ?? defaultSandboxRoot(), retentionDays });

  console.log(`Sandbox root : ${plan.root}`);
  console.log(`Retention    : ${plan.retentionDays} day(s)`);
  console.log(`Selected     : ${plan.selected.length} sandbox(es), ${formatMb(plan.totalBytes)}`);

  for (const entry of plan.selected) {
    console.log(`  ${entry.name}  ${String(entry.ageDays).padStart(4)}d  ${formatMb(entry.bytes).padStart(9)}`);
  }

  if (plan.selected.length === 0) {
    console.log("\nNothing to prune.");
    return;
  }

  if (!args.apply) {
    console.log(`\nDry run — nothing removed. Re-run with --apply to reclaim ${formatMb(plan.totalBytes)}.`);
    return;
  }

  const removed = await applySandboxPrune(plan);
  console.log(`\nRemoved ${removed} sandbox(es), reclaiming up to ${formatMb(plan.totalBytes)}.`);
}

if (import.meta.main) {
  await main();
}
