/**
 * @module Readiness
 * @path apps/daemon/src/readiness.ts
 * @description Phase 121 Step 1 — daemon readiness signal utility.
 *   Writes and removes a zero-byte `.exa/ready` marker file so external
 *   scripts (e.g. `wait_for_daemon.ts`) can poll for completion of startup.
 * @architectural-layer Services
 * @dependencies [@std/path]
 * @related-files [apps/daemon/main.ts, scripts/wait_for_daemon.ts]
 */

import { join } from "@std/path";

const READY_FILE = "ready";
const EXA_DIR = ".exa";

function readyPath(rootDir: string): string {
  return join(rootDir, EXA_DIR, READY_FILE);
}

/**
 * Write a zero-byte readiness marker at {rootDir}/.exa/ready.
 * Creates the .exa/ directory if it does not exist.
 */
export function writeReadinessMarker(rootDir: string): void {
  const dir = join(rootDir, EXA_DIR);
  try {
    Deno.mkdirSync(dir, { recursive: true });
  } catch {
    // Directory already exists
  }
  Deno.writeTextFileSync(readyPath(rootDir), "");
}

/**
 * Remove the readiness marker at {rootDir}/.exa/ready.
 * No-op if the marker does not exist.
 */
export function removeReadinessMarker(rootDir: string): void {
  try {
    Deno.removeSync(readyPath(rootDir));
  } catch {
    // File already removed — no-op
  }
}

/**
 * Poll for the readiness marker up to `timeoutMs` milliseconds.
 * Checks every 500ms. Returns true when the marker appears, false on timeout.
 */
export async function waitForReadiness(rootDir: string, timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      Deno.statSync(readyPath(rootDir));
      return true;
    } catch {
      // Marker not yet present — wait and retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
