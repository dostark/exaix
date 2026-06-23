#!/usr/bin/env -S deno run -A
/**
 * @module DogfoodClean
 * @path scripts/dogfood_clean.ts
 * @description Guarded removal of the dogfood sandbox root (Phase 124 R13).
 *   Resolves the configured external sandbox root (DOGFOOD_ROOT or the `root`
 *   field in configs/dogfood.toml — the sandbox lives outside the repo), refuses
 *   any path that is not the realpath-equal configured root (GAP-4: symlink- and
 *   `..`-safe), refuses while the daemon PID is alive, then removes the tree.
 *   Never `rm -rf`s an arbitrary argument.
 *
 * Usage:
 *   deno run -A scripts/dogfood_clean.ts            # prompts for confirmation
 *   deno run -A scripts/dogfood_clean.ts --force    # skip the prompt
 *   deno run -A scripts/dogfood_clean.ts --path P   # request a specific path
 *                                                   # (only removed if it equals
 *                                                   #  the configured root)
 *
 * Environment:
 *   DOGFOOD_ROOT     Override sandbox root (for testing with isolated temp dirs)
 *   EXA_CONFIG_PATH  Config file path (set by bootstrap or user)
 */

import { dirname, fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), ".."));
const DEFAULT_CONFIG_PATH = join(REPO_ROOT, "configs/dogfood.toml");

function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  Deno.exit(1);
}

function getConfigPath(): string {
  return Deno.env.get("EXA_CONFIG_PATH") ?? DEFAULT_CONFIG_PATH;
}

/** Resolve the configured dogfood root (DOGFOOD_ROOT wins, else `[system].root`). */
function resolveConfiguredRoot(): string {
  const envRoot = Deno.env.get("DOGFOOD_ROOT");
  if (envRoot) return resolve(envRoot);

  let content: string;
  try {
    content = Deno.readTextFileSync(getConfigPath());
  } catch {
    fail(`could not read dogfood config at ${getConfigPath()}`);
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) continue;
    const match = trimmed.match(/^root\s*=\s*"(.+)"$/);
    if (match) {
      const val = match[1];
      if (val === "__DOGFOOD_ROOT__") fail("config still contains the __DOGFOOD_ROOT__ sentinel");
      return val.startsWith("/") ? val : join(REPO_ROOT, val);
    }
  }
  fail("could not determine dogfood root from config");
}

/**
 * GAP-4 guard. Returns the realpath of the configured root only if `target`
 * realpath-equals it and is not a symlink. Refuses everything else.
 */
async function assertRemovableRoot(configuredRoot: string, target: string): Promise<string> {
  let expectedReal: string;
  let targetReal: string;
  try {
    expectedReal = await Deno.realPath(configuredRoot);
  } catch {
    fail(`configured dogfood root does not exist: ${configuredRoot}`);
  }
  try {
    targetReal = await Deno.realPath(target);
  } catch {
    fail(`target path does not exist: ${target}`);
  }

  // Refuse if the requested target's own entry is a symlink (do not follow it for deletion).
  const lstat = await Deno.lstat(target);
  if (lstat.isSymlink) fail(`refusing to remove a symlinked root: ${target}`);

  if (targetReal !== expectedReal) {
    fail(`refusing to remove ${targetReal} — only the configured dogfood root ${expectedReal} is removable`);
  }
  return targetReal;
}

/** True if a daemon PID file exists and that process is still alive. */
function isDaemonAlive(root: string): boolean {
  const pidPath = join(root, ".exa", "daemon.pid");
  let pid: number;
  try {
    pid = Number(Deno.readTextFileSync(pidPath).trim());
  } catch {
    return false; // no PID file → not running
  }
  if (Number.isNaN(pid)) return false;
  try {
    Deno.kill(pid, 0); // signal 0 = liveness probe
    return true;
  } catch {
    return false; // process gone
  }
}

async function main(): Promise<void> {
  const args = Deno.args;
  const force = args.includes("--force");
  const pathIdx = args.indexOf("--path");
  const requested = pathIdx >= 0 && args[pathIdx + 1] ? resolve(args[pathIdx + 1]) : undefined;

  const configuredRoot = resolveConfiguredRoot();
  const target = requested ?? configuredRoot;

  // Refuse while the daemon is alive (initial check).
  if (isDaemonAlive(configuredRoot)) {
    fail("daemon is still running — stop it first (deno task dogfood:stop)");
  }

  const removable = await assertRemovableRoot(configuredRoot, target);

  if (!force) {
    const confirmed = confirm(`Remove dogfood sandbox at ${removable}?`);
    if (!confirmed) {
      console.log("Aborted.");
      return;
    }
  }

  // TOCTOU re-check immediately before removal — a daemon could have started.
  if (isDaemonAlive(configuredRoot)) {
    fail("daemon started during confirmation — aborting removal");
  }

  await Deno.remove(removable, { recursive: true });
  console.log(`Removed ${removable}`);
}

if (import.meta.main) {
  await main();
}
