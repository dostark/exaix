/**
 * @module DaemonSpawnPermissionsTest
 * @path packages/core/tests/daemon_spawn_permissions_test.ts
 * @description Verifies the daemon least-privilege spawn permission constants
 *   (Phase 124 Step 1): the typed IDaemonSpawnPermissions structure, the
 *   run-binary allowlist (single source of truth), and the default net hosts.
 * @architectural-layer Tests
 * @related-files ["packages/core/src/types/constants.ts"]
 */

import { assertEquals } from "@std/assert";
import { DAEMON_DEFAULT_NET_HOSTS, DAEMON_SPAWN_PERMISSIONS, DAEMON_SPAWN_RUN_BINARIES } from "@exaix/core/types";

Deno.test("[daemon_perms] DAEMON_SPAWN_PERMISSIONS includes net, read, write, run, env, import", () => {
  // Structured typed permission set — not a flat string array (GAP-7).
  assertEquals(Array.isArray(DAEMON_SPAWN_PERMISSIONS.read), true);
  assertEquals(Array.isArray(DAEMON_SPAWN_PERMISSIONS.write), true);
  assertEquals(Array.isArray(DAEMON_SPAWN_PERMISSIONS.run), true);
  assertEquals(DAEMON_SPAWN_PERMISSIONS.env, true);
  assertEquals(DAEMON_SPAWN_PERMISSIONS.ffi, true);
  assertEquals(DAEMON_SPAWN_PERMISSIONS.import, true);
  // Net is governed by config.allow_net at spawn time; the default list lives here.
  assertEquals(DAEMON_SPAWN_PERMISSIONS.net, DAEMON_DEFAULT_NET_HOSTS);
});

Deno.test("[daemon_perms] run allowlist includes git, deno, opencode, claude", () => {
  assertEquals(DAEMON_SPAWN_RUN_BINARIES.includes("git"), true);
  assertEquals(DAEMON_SPAWN_RUN_BINARIES.includes("deno"), true);
  assertEquals(DAEMON_SPAWN_RUN_BINARIES.includes("opencode"), true);
  assertEquals(DAEMON_SPAWN_RUN_BINARIES.includes("claude"), true);
});

Deno.test("[daemon_perms] DAEMON_SPAWN_PERMISSIONS.run is the same reference as DAEMON_SPAWN_RUN_BINARIES (single source — GAP-6)", () => {
  assertEquals(DAEMON_SPAWN_PERMISSIONS.run, DAEMON_SPAWN_RUN_BINARIES);
});

Deno.test("[daemon_perms] default net hosts cover the built-in providers", () => {
  assertEquals(DAEMON_DEFAULT_NET_HOSTS.includes("api.anthropic.com"), true);
  assertEquals(DAEMON_DEFAULT_NET_HOSTS.includes("api.openai.com"), true);
  assertEquals(DAEMON_DEFAULT_NET_HOSTS.includes("localhost:11434"), true);
});
