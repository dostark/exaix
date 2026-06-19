#!/usr/bin/env -S deno run -A
/**
 * @module WaitForDaemon
 * @path scripts/wait_for_daemon.ts
 * @description Phase 121 Step 1 — polls the daemon readiness marker at
 *   <root>/.exa/ready and exits 0 on detection, 1 on timeout.
 *   Usage: deno run -A scripts/wait_for_daemon.ts [root-dir]
 *   Default root-dir: .dogfood
 */

import { join } from "@std/path";

const ROOT_DIR = Deno.args[0] ?? ".dogfood";
const READY_PATH = join(ROOT_DIR, ".exa", "ready");
const TIMEOUT_MS = 30_000;
const POLL_MS = 2_000;

const deadline = Date.now() + TIMEOUT_MS;
while (Date.now() < deadline) {
  try {
    Deno.statSync(READY_PATH);
    console.error("\nDaemon ready.");
    Deno.exit(0);
  } catch {
    // Not ready yet
  }
  console.error(".");
  await new Promise((r) => setTimeout(r, POLL_MS));
}
console.error("\nTimeout waiting for daemon readiness.");
Deno.exit(1);
