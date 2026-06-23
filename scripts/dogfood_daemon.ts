#!/usr/bin/env -S deno run -A
/**
 * @module DogfoodDaemon
 * @path scripts/dogfood_daemon.ts
 * @description Manages the dogfood daemon lifecycle — start, stop, status.
 *   Reads the dogfood config (configs/dogfood.toml or EXA_CONFIG_PATH) to resolve
 *   the sandbox root and PID file. Supports DOGFOOD_ROOT for test isolation.
 *
 * Usage:
 *   deno run -A scripts/dogfood_daemon.ts start
 *   deno run -A scripts/dogfood_daemon.ts stop
 *   deno run -A scripts/dogfood_daemon.ts status
 *
 * Environment:
 *   DOGFOOD_ROOT   Override sandbox root (for testing with isolated temp dirs)
 *   EXA_CONFIG_PATH  Config file path (set by bootstrap or user)
 *   EXA_TEST_MODE  Passed to daemon subprocess
 */

import { ensureDir } from "@std/fs";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { DAEMON_DEFAULT_NET_HOSTS, DAEMON_SPAWN_RUN_BINARIES } from "@exaix/core/types";

const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), ".."));
const DEFAULT_CONFIG_PATH = join(REPO_ROOT, "configs/dogfood.toml");

function getConfigPath(): string {
  const cfgFromEnv = Deno.env.get("EXA_CONFIG_PATH");
  if (cfgFromEnv) return cfgFromEnv;

  // When DOGFOOD_ROOT is set, create a resolved copy of the default config
  const envRoot = Deno.env.get("DOGFOOD_ROOT");
  if (envRoot) {
    const resolvedRoot = resolve(envRoot);
    const content = Deno.readTextFileSync(DEFAULT_CONFIG_PATH);
    const updated = content.replaceAll("__DOGFOOD_ROOT__", resolvedRoot);
    const tempCfg = join(resolvedRoot, ".exa", "dogfood-config.toml");
    Deno.writeTextFileSync(tempCfg, updated);
    return tempCfg;
  }

  return DEFAULT_CONFIG_PATH;
}

function resolveRoot(): string {
  const envRoot = Deno.env.get("DOGFOOD_ROOT");
  if (envRoot) {
    return resolve(envRoot);
  }

  const configPath = getConfigPath();
  const content = Deno.readTextFileSync(configPath);
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) continue;
    const match = trimmed.match(/^root\s*=\s*"(.+)"$/);
    if (match) {
      const val = match[1];
      if (val === "__DOGFOOD_ROOT__") {
        console.error(
          "Error: Config still contains __DOGFOOD_ROOT__ sentinel.\n" +
            "  Run: deno run -A scripts/dogfood_bootstrap.ts --dir <path> --worktree <path>\n" +
            "  Or set: DOGFOOD_ROOT=/path/to/sandbox",
        );
        Deno.exit(1);
      }
      if (!val.startsWith("/")) {
        return join(REPO_ROOT, val);
      }
      return val;
    }
  }
  console.error("Error: Could not determine dogfood root from config");
  Deno.exit(1);
}

function getRuntimeDir(): string {
  return join(resolveRoot(), ".exa");
}

function getPidPath(): string {
  return join(getRuntimeDir(), "daemon.pid");
}

/**
 * Resolve the `--allow-net` flag from the dogfood config's `[system].allow_net`,
 * mirroring DaemonCommands.buildSpawnFlags (Phase 124 Step 2). Returns `null`
 * when outbound should be blocked (no flag emitted). GAP-2: an explicit empty
 * array blocks; a config-read error falls back to the open default list.
 */
function resolveDogfoodNetFlag(configPath: string): string | null {
  let allowNet: string[] | undefined;
  try {
    const parsed = parseToml(Deno.readTextFileSync(configPath)) as { system?: { allow_net?: string[] } };
    allowNet = parsed.system?.allow_net;
  } catch {
    // Config unreadable/unparseable — fall back to the open default list.
    return `--allow-net=${DAEMON_DEFAULT_NET_HOSTS.join(",")}`;
  }
  if (allowNet === undefined) return `--allow-net=${DAEMON_DEFAULT_NET_HOSTS.join(",")}`;
  if (allowNet.length === 0) return null; // intentional block — no flag
  return `--allow-net=${allowNet.join(",")}`;
}

async function cmdStart(): Promise<void> {
  const runtimeDir = getRuntimeDir();
  await ensureDir(runtimeDir);

  const pidPath = getPidPath();
  const daemonEntry = join(REPO_ROOT, "apps/daemon/main.ts");
  const configPath = getConfigPath();
  const logPath = join(runtimeDir, "daemon.log");

  // GAP-6: single source of truth for the run allowlist — shared with
  // DaemonCommands.buildSpawnFlags() so the two launch paths cannot drift.
  const allowRunBinaries = DAEMON_SPAWN_RUN_BINARIES.join(",");
  const netFlag = resolveDogfoodNetFlag(configPath);

  // Phase 124 Step 2/5: the least-privilege flag set (never blanket --allow-all).
  // Write scope is the daemon's data root (where it writes the journal, logs, and
  // Workspace) AND the repo root (for any in-repo artifacts). Scoping to REPO_ROOT
  // alone denies all writes when the daemon root is an out-of-repo sandbox (e.g.
  // DOGFOOD_ROOT under /tmp) — caught by the Step 5 cutover.
  const dataRoot = resolveRoot();
  const spawnFlags = [
    "--allow-read",
    `--allow-write=${dataRoot},${REPO_ROOT}`,
    ...(netFlag ? [netFlag] : []),
    "--allow-env",
    "--allow-ffi",
    "--allow-import",
    `--allow-run=${allowRunBinaries}`,
  ];
  // Log the effective flags so the cutover test can assert the daemon booted
  // under narrowed permissions (not --allow-all).
  console.log(`Daemon spawn flags: ${spawnFlags.join(" ")}`);

  const proc = new Deno.Command("deno", {
    args: ["run", ...spawnFlags, daemonEntry],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: {
      EXA_CONFIG_PATH: configPath,
      ...(Deno.env.get("EXA_TEST_MODE") ? { EXA_TEST_MODE: "1" } : {}),
    },
  }).spawn();

  (async () => {
    const logFile = await Deno.open(logPath, { write: true, create: true, append: true });
    try {
      await proc.stdout.pipeTo(logFile.writable, { preventClose: true });
    } catch {
      // ignore pipe errors
    }
  })();
  (async () => {
    const logFile = await Deno.open(logPath, { write: true, create: true, append: true });
    try {
      await proc.stderr.pipeTo(logFile.writable, { preventClose: true });
    } catch {
      // ignore pipe errors
    }
  })();

  Deno.writeTextFileSync(pidPath, String(proc.pid));
  console.log(`Daemon started (PID ${proc.pid})`);
  Deno.exit(0);
}

async function cmdStop(): Promise<void> {
  const pidPath = getPidPath();
  let pid: number;
  try {
    const content = Deno.readTextFileSync(pidPath).trim();
    pid = Number(content);
    if (isNaN(pid)) {
      console.error("Invalid PID in", pidPath);
      Deno.exit(1);
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      console.error("Daemon is not running (no PID file)");
      Deno.exit(1);
    }
    throw e;
  }

  try {
    Deno.kill(pid, "SIGTERM");
  } catch {
    // already dead
  }

  for (let i = 0; i < 50; i++) {
    try {
      Deno.kill(pid, 0);
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      try {
        Deno.removeSync(pidPath);
      } catch {
        // ignore
      }
      console.log("Daemon stopped");
      return;
    }
  }

  try {
    Deno.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }
  try {
    Deno.removeSync(pidPath);
  } catch {
    // ignore
  }
  console.log("Daemon force-stopped (SIGKILL)");
}

function cmdStatus(): void {
  const pidPath = getPidPath();
  try {
    const content = Deno.readTextFileSync(pidPath).trim();
    const pid = Number(content);
    if (isNaN(pid)) throw new Error("invalid PID");
    Deno.kill(pid, 0);
    console.log(`running (PID ${pid})`);
    Deno.exit(0);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      console.log("not running");
      Deno.exit(1);
    }
    try {
      Deno.removeSync(pidPath);
    } catch {
      // ignore
    }
    console.log("not running (stale PID file cleaned up)");
    Deno.exit(1);
  }
}

async function main() {
  const cmd = Deno.args[0];
  switch (cmd) {
    case "start":
      await cmdStart();
      break;
    case "stop":
      await cmdStop();
      break;
    case "status":
      cmdStatus();
      break;
    default:
      console.error("Usage: dogfood_daemon.ts <start|stop|status>");
      Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
