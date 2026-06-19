#!/usr/bin/env -S deno run -A
/**
 * @module WaitForDaemon
 * @path scripts/wait_for_daemon.ts
 * @description Phase 121 Step 1 — polls the daemon PID file and verifies the
 *   process is alive (same mechanism as `exactl daemon status`). Exits 0 on
 *   detection, 1 on timeout. No file marker needed — the PID file + kill -0
 *   check is not spoofable.
 *   Usage: deno run -A scripts/wait_for_daemon.ts [root-dir]
 *   Default root-dir: .dogfood
 */

import { join } from "@std/path";
import { isProcessAlive } from "@exaix/cli/process_utils.ts";

const ROOT_DIR = Deno.args[0] ?? ".dogfood";
const PID_PATH = join(ROOT_DIR, ".exa", "daemon.pid");
const TIMEOUT_MS = 30_000;
const POLL_MS = 2_000;

const deadline = Date.now() + TIMEOUT_MS;
while (Date.now() < deadline) {
  try {
    const pidRaw = Deno.readTextFileSync(PID_PATH);
    const pid = parseInt(pidRaw.trim(), 10);
    if (!isNaN(pid) && await isProcessAlive(pid)) {
      console.error(`\nDaemon ready (pid ${pid}).`);
      Deno.exit(0);
    }
  } catch {
    // PID file not found — not ready yet
  }
  console.error(".");
  await new Promise((r) => setTimeout(r, POLL_MS));
}
console.error("\nTimeout waiting for daemon readiness.");
Deno.exit(1);
