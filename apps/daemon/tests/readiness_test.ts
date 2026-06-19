/**
 * @module ReadinessTest
 * @path apps/daemon/tests/readiness_test.ts
 * @description Phase 121 Step 1 — tests for the daemon readiness signal utilities.
 *   Verifies writeReadinessMarker, removeReadinessMarker, and waitForReadiness.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { removeReadinessMarker, waitForReadiness, writeReadinessMarker } from "../src/readiness.ts";

Deno.test("[readiness] writeReadinessMarker creates .exa/ready file", () => {
  const dir = Deno.makeTempDirSync();
  try {
    writeReadinessMarker(dir);
    const marker = join(dir, ".exa", "ready");
    const stat = Deno.statSync(marker);
    assertEquals(stat.isFile, true);
    assertEquals(stat.size, 0, "marker must be zero-byte");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("[readiness] removeReadinessMarker deletes .exa/ready file", () => {
  const dir = Deno.makeTempDirSync();
  try {
    writeReadinessMarker(dir);
    const marker = join(dir, ".exa", "ready");
    assertEquals(Deno.statSync(marker).isFile, true);
    removeReadinessMarker(dir);
    let exists = true;
    try {
      Deno.statSync(marker);
    } catch {
      exists = false;
    }
    assertEquals(exists, false, "marker must be removed");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("[readiness] waitForReadiness returns true when marker present", async () => {
  const dir = Deno.makeTempDirSync();
  try {
    writeReadinessMarker(dir);
    const result = await waitForReadiness(dir, 1000);
    assertEquals(result, true);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("[readiness] waitForReadiness returns false on timeout", async () => {
  const dir = Deno.makeTempDirSync();
  try {
    // No marker written — should timeout
    const result = await waitForReadiness(dir, 500);
    assertEquals(result, false);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
