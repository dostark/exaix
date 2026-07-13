/**
 * @module Readiness
 * @path apps/daemon/src/readiness.ts
 * @description Phase 121 Step 1 — daemon readiness utility.
 *   Polls the daemon PID file and verifies the process is alive via
 *   `kill -0`, reusing the same mechanism as `exactl daemon status`.
 *   No file marker needed — the existing PID file + process liveness
 *   check is not spoofable (a fake PID won't pass kill -0).
 * @architectural-layer Services
 * @dependencies [@std/path, @exaix/cli]
 * @related-files [scripts/wait_for_daemon.ts]
 */

import { join } from "@std/path";
import { isProcessAlive } from "@exaix/cli/process_utils.ts";
import { DEFAULT_TIMEOUT_MS } from "@exaix/core";

/** .exa/daemon.pid path for a given daemon root. */
function pidPath(rootDir: string): string {
  return join(rootDir, ".exa", "daemon.pid");
}

/**
 * Poll for the daemon PID file and verify the process is alive.
 * Checks every 500ms. Returns true when the daemon is running, false on timeout.
 */
export async function waitForReadiness(rootDir: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pidRaw = Deno.readTextFileSync(pidPath(rootDir));
      const pid = parseInt(pidRaw.trim(), 10);
      if (!isNaN(pid) && await isProcessAlive(pid)) {
        return true;
      }
    } catch {
      // PID file not found — wait and retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
