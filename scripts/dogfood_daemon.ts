#!/usr/bin/env -S deno run -A
/**
 * @module DogfoodDaemon
 * @path scripts/dogfood_daemon.ts
 * @description Manages the dogfood daemon lifecycle — start, stop, status.
 *   Reads configs/dogfood.toml to resolve the runtime directory and PID file path.
 *   Spawns apps/daemon/main.ts as a subprocess.
 *
 * Usage:
 *   deno run -A scripts/dogfood_daemon.ts start
 *   deno run -A scripts/dogfood_daemon.ts stop
 *   deno run -A scripts/dogfood_daemon.ts status
 */

import { ensureDir } from "@std/fs";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), ".."));
const DOGFOOD_CONFIG_PATH = join(REPO_ROOT, "configs/dogfood.toml");

function getRootFromConfig(): string {
  const content = Deno.readTextFileSync(DOGFOOD_CONFIG_PATH);
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[system]")) continue;
    const match = trimmed.match(/^root\s*=\s*"(.+)"$/);
    if (match) return match[1];
  }
  return "./.dogfood";
}

function getRuntimeDir(): string {
  let root = getRootFromConfig();
  if (!root.startsWith("/")) {
    root = join(REPO_ROOT, root);
  }
  return join(root, ".exa");
}

function getPidPath(): string {
  return join(getRuntimeDir(), "daemon.pid");
}

async function cmdStart(): Promise<void> {
  const runtimeDir = getRuntimeDir();
  await ensureDir(runtimeDir);

  const pidPath = getPidPath();
  const daemonEntry = join(REPO_ROOT, "apps/daemon/main.ts");

  const allowRunBinaries = [
    "git",
    "deno",
    "npm",
    "node",
    "exoctl",
    "ls",
    "grep",
    "echo",
    "printf",
    "pwd",
    "whoami",
    "id",
    "date",
    "uptime",
    "which",
    "type",
    "command",
    "hash",
    "alias",
  ].join(",");

  const logPath = join(getRuntimeDir(), "daemon.log");

  const proc = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      `--allow-write=${REPO_ROOT}`,
      "--allow-net",
      "--allow-env",
      "--allow-ffi",
      "--allow-import",
      `--allow-run=${allowRunBinaries}`,
      daemonEntry,
    ],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: {
      EXA_CONFIG_PATH: DOGFOOD_CONFIG_PATH,
      ...(Deno.env.get("EXA_TEST_MODE") ? { EXA_TEST_MODE: "1" } : {}),
    },
  }).spawn();

  // Pipe daemon output to log file
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
    // Process may already be dead
  }

  // Wait up to 5 seconds for the process to exit
  for (let i = 0; i < 50; i++) {
    try {
      Deno.kill(pid, 0);
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      // Process exited
      try {
        Deno.removeSync(pidPath);
      } catch {
        // PID file may already be removed
      }
      console.log("Daemon stopped");
      return;
    }
  }

  // Force kill
  try {
    Deno.kill(pid, "SIGKILL");
  } catch {
    // Process already dead
  }
  try {
    Deno.removeSync(pidPath);
  } catch {
    // PID file may already be removed
  }
  console.log("Daemon force-stopped (SIGKILL)");
}

function cmdStatus(): void {
  const pidPath = getPidPath();
  try {
    const content = Deno.readTextFileSync(pidPath).trim();
    const pid = Number(content);
    if (isNaN(pid)) {
      console.log("not running (invalid PID file)");
      Deno.exit(1);
    }
    Deno.kill(pid, 0);
    console.log(`running (PID ${pid})`);
    Deno.exit(0);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      console.log("not running");
      Deno.exit(1);
    }
    // PID exists but process not found
    try {
      Deno.removeSync(pidPath);
    } catch {
      // ignore cleanup errors
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
