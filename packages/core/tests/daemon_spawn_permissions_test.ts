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
  const dAEMON_SPAWN_RUN_BINARIESIncludesGit: boolean = DAEMON_SPAWN_RUN_BINARIES.includes("git");
  assertEquals(dAEMON_SPAWN_RUN_BINARIESIncludesGit, true, "DAEMON_SPAWN_RUN_BINARIES should include 'git'");
  const dAEMON_SPAWN_RUN_BINARIESIncludesDeno: boolean = DAEMON_SPAWN_RUN_BINARIES.includes("deno");
  assertEquals(dAEMON_SPAWN_RUN_BINARIESIncludesDeno, true, "DAEMON_SPAWN_RUN_BINARIES should include 'deno'");
  const dAEMON_SPAWN_RUN_BINARIESIncludesOpencode: boolean = DAEMON_SPAWN_RUN_BINARIES.includes("opencode");
  assertEquals(dAEMON_SPAWN_RUN_BINARIESIncludesOpencode, true, "DAEMON_SPAWN_RUN_BINARIES should include 'opencode'");
  const dAEMON_SPAWN_RUN_BINARIESIncludesClaude: boolean = DAEMON_SPAWN_RUN_BINARIES.includes("claude");
  assertEquals(dAEMON_SPAWN_RUN_BINARIESIncludesClaude, true, "DAEMON_SPAWN_RUN_BINARIES should include 'claude'");
});

Deno.test("[daemon_perms][security] run allowlist includes Codex and excludes arbitrary executables", () => {
  const dAEMON_SPAWN_RUN_BINARIESIncludesSESSION_BIN_CODEX: boolean = DAEMON_SPAWN_RUN_BINARIES.includes(
    SESSION_BIN_CODEX,
  );
  assertEquals(
    dAEMON_SPAWN_RUN_BINARIESIncludesSESSION_BIN_CODEX,
    true,
    "DAEMON_SPAWN_RUN_BINARIES should include SESSION_BIN_CODEX",
  );
  assertFalse(DAEMON_SPAWN_RUN_BINARIES.includes("arbitrary-executable"));
});

Deno.test("[daemon_perms] run allowlist names the real exactl binary, not the phantom 'exoctl'", () => {
  // Regression: a historical typo (`exoctl`) leaked into the daemon --allow-run set, so
  // the daemon could never spawn the real `exactl` CLI.
  const dAEMON_SPAWN_RUN_BINARIESIncludesExactl: boolean = DAEMON_SPAWN_RUN_BINARIES.includes("exactl");
  assertEquals(dAEMON_SPAWN_RUN_BINARIESIncludesExactl, true, "must allow the real `exactl` binary");
  assertFalse(DAEMON_SPAWN_RUN_BINARIES.includes("exoctl"), "must not list the non-existent `exoctl`");
});

Deno.test("[daemon_perms] DAEMON_SPAWN_PERMISSIONS.run is the same reference as DAEMON_SPAWN_RUN_BINARIES (single source — GAP-6)", () => {
  assertEquals(DAEMON_SPAWN_PERMISSIONS.run, DAEMON_SPAWN_RUN_BINARIES);
});

Deno.test("[daemon_perms] default net hosts cover the built-in providers", () => {
  const dAEMON_DEFAULT_NET_HOSTSIncludesApiAnthropicCom: boolean = DAEMON_DEFAULT_NET_HOSTS.includes(
    "api.anthropic.com",
  );
  assertEquals(
    dAEMON_DEFAULT_NET_HOSTSIncludesApiAnthropicCom,
    true,
    "DAEMON_DEFAULT_NET_HOSTS should include 'api.anthropic.com'",
  );
  const dAEMON_DEFAULT_NET_HOSTSIncludesApiOpenaiCom: boolean = DAEMON_DEFAULT_NET_HOSTS.includes("api.openai.com");
  assertEquals(
    dAEMON_DEFAULT_NET_HOSTSIncludesApiOpenaiCom,
    true,
    "DAEMON_DEFAULT_NET_HOSTS should include 'api.openai.com'",
  );
  const dAEMON_DEFAULT_NET_HOSTSIncludesLocalhost11434: boolean = DAEMON_DEFAULT_NET_HOSTS.includes("localhost:11434");
  assertEquals(
    dAEMON_DEFAULT_NET_HOSTSIncludesLocalhost11434,
    true,
    "DAEMON_DEFAULT_NET_HOSTS should include 'localhost:11434'",
  );
});
