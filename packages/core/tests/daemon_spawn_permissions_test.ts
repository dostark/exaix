/**
 * @module DaemonSpawnPermissionsTest
 * @path packages/core/tests/daemon_spawn_permissions_test.ts
 * @description Verifies the daemon least-privilege spawn permission constants
 *   (Phase 124 Step 1): the typed IDaemonSpawnPermissions structure, the
 *   run-binary allowlist (single source of truth), and the default net hosts.
 * @architectural-layer Tests
 * @related-files ["packages/core/src/types/constants.ts"]
 */

import { assertEquals, assertFalse } from "@std/assert";
import {
  DAEMON_DEFAULT_NET_HOSTS,
  DAEMON_SPAWN_PERMISSIONS,
  DAEMON_SPAWN_RUN_BINARIES,
  SESSION_BIN_CODEX,
} from "@exaix/core/types";

Deno.test("[daemon_perms] DAEMON_SPAWN_PERMISSIONS includes net, read, write, run, env, import", () => {
  // Structured typed permission set — not a flat string array.
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
  const assertionResult: boolean = DAEMON_SPAWN_RUN_BINARIES.includes("git");
  assertEquals(assertionResult, true);
  const assertionResult2: boolean = DAEMON_SPAWN_RUN_BINARIES.includes("deno");
  assertEquals(assertionResult2, true);
  const assertionResult3: boolean = DAEMON_SPAWN_RUN_BINARIES.includes("opencode");
  assertEquals(assertionResult3, true);
  const assertionResult4: boolean = DAEMON_SPAWN_RUN_BINARIES.includes("claude");
  assertEquals(assertionResult4, true);
});

Deno.test("[daemon_perms][security] run allowlist includes Codex and excludes arbitrary executables", () => {
  const assertionResult5: boolean = DAEMON_SPAWN_RUN_BINARIES.includes(SESSION_BIN_CODEX);
  assertEquals(assertionResult5, true);
  assertFalse(DAEMON_SPAWN_RUN_BINARIES.includes("arbitrary-executable"));
});

Deno.test("[daemon_perms] run allowlist names the real exactl binary, not the phantom 'exoctl'", () => {
  // Regression: a historical typo (`exoctl`) leaked into the daemon --allow-run set, so
  // the daemon could never spawn the real `exactl` CLI.
  const assertionResult6: boolean = DAEMON_SPAWN_RUN_BINARIES.includes("exactl");
  assertEquals(assertionResult6, true, "must allow the real `exactl` binary");
  assertFalse(DAEMON_SPAWN_RUN_BINARIES.includes("exoctl"), "must not list the non-existent `exoctl`");
});

Deno.test("[daemon_perms] DAEMON_SPAWN_PERMISSIONS.run is the same reference as DAEMON_SPAWN_RUN_BINARIES (single source — GAP-6)", () => {
  assertEquals(DAEMON_SPAWN_PERMISSIONS.run, DAEMON_SPAWN_RUN_BINARIES);
});

Deno.test("[daemon_perms] default net hosts cover the built-in providers", () => {
  const assertionResult7: boolean = DAEMON_DEFAULT_NET_HOSTS.includes("api.anthropic.com");
  assertEquals(assertionResult7, true);
  const assertionResult8: boolean = DAEMON_DEFAULT_NET_HOSTS.includes("api.openai.com");
  assertEquals(assertionResult8, true);
  const assertionResult9: boolean = DAEMON_DEFAULT_NET_HOSTS.includes("localhost:11434");
  assertEquals(assertionResult9, true);
});
