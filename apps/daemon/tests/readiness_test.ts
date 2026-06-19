/**
 * @module ReadinessTest
 * @path apps/daemon/tests/readiness_test.ts
 * @description Phase 121 Step 1 — tests for daemon readiness via PID polling.
 *   Uses `waitForReadiness` which polls the PID file + `isProcessAlive`.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { waitForReadiness } from "../src/readiness.ts";

Deno.test("[readiness] waitForReadiness returns true when PID file contains a live PID", async () => {
  const dir = Deno.makeTempDirSync();
  try {
    Deno.mkdirSync(join(dir, ".exa"));
    Deno.writeTextFileSync(join(dir, ".exa", "daemon.pid"), String(Deno.pid));
    const result = await waitForReadiness(dir, 1000);
    assertEquals(result, true);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("[readiness] waitForReadiness returns false on timeout (no PID file)", async () => {
  const dir = Deno.makeTempDirSync();
  try {
    const result = await waitForReadiness(dir, 500);
    assertEquals(result, false);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("[readiness] waitForReadiness returns false for a non-existent PID", async () => {
  const dir = Deno.makeTempDirSync();
  try {
    Deno.mkdirSync(join(dir, ".exa"));
    Deno.writeTextFileSync(join(dir, ".exa", "daemon.pid"), "999999999");
    const result = await waitForReadiness(dir, 500);
    assertEquals(result, false);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
