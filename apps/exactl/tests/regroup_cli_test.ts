/**
 * @module RegroupCliTest
 * @path apps/exactl/tests/regroup_cli_test.ts
 * @description Runs the real exactl binary against the grouped config lock, config profile and portal knowledge commands.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/command_builders/config_command.ts, apps/exactl/src/command_builders/portal_command.ts]
 */

import { assertEquals, assertNotEquals, assertNotMatch, assertStringIncludes } from "@std/assert";
import { runExactlSequenceInTempWorkspace } from "./helpers/exactl_cli_process.ts";

const USAGE_EXIT_CODE = 2;
const LOCKED_KEY = "ai.timeout_ms";

Deno.test("config lock add, list and remove round-trip", async () => {
  const [add, listed, remove, empty] = await runExactlSequenceInTempWorkspace([
    ["config", "lock", "add", LOCKED_KEY, "--reason", "pinned for tests"],
    ["config", "lock", "list"],
    ["config", "lock", "remove", LOCKED_KEY],
    ["config", "lock", "list"],
  ]);
  assertEquals(add.code, 0, add.stderr);
  assertStringIncludes(listed.stdout + listed.stderr, LOCKED_KEY);
  assertEquals(remove.code, 0, remove.stderr);
  assertNotMatch(empty.stdout + empty.stderr, /ai\.timeout_ms/);
});

Deno.test("config profile list shows a profile and config profile use activates it", async () => {
  const [set, listed, use, active] = await runExactlSequenceInTempWorkspace([
    ["config", "set", "--profile", "dev", LOCKED_KEY, "40000"],
    ["config", "profile", "list"],
    ["config", "profile", "use", "dev"],
    ["config", "get", "system.active_profile"],
  ]);
  assertEquals(set.code, 0, set.stderr);
  assertStringIncludes(listed.stdout, "dev");
  assertEquals(use.code, 0, use.stderr);
  assertStringIncludes(active.stdout + active.stderr, "dev");
});

Deno.test("portal knowledge show and analyze reach their handlers and fail on an unknown portal", async () => {
  const [show, analyze] = await runExactlSequenceInTempWorkspace([
    ["portal", "knowledge", "show", "no-such-portal"],
    ["portal", "knowledge", "analyze", "no-such-portal"],
  ]);
  for (const run of [show, analyze]) {
    assertNotEquals(run.code, USAGE_EXIT_CODE, run.stderr);
    assertNotEquals(run.code, 0);
  }
});
