/**
 * @module LogCommandCliTest
 * @path apps/exactl/tests/log_command_cli_test.ts
 * @description Runs the real exactl binary against `log wait`, `log verify` and `log cost` in a fresh workspace.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/command_builders/log_command.ts, apps/exactl/src/commands/journal_commands.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { runExactlInTempWorkspace } from "./helpers/exactl_cli_process.ts";

const FAILURE_EXIT_CODE = 1;

Deno.test("log wait exits 1 with a timeout message when the event never appears", async () => {
  const run = await runExactlInTempWorkspace(["log", "wait", "--event", "never.happens", "--timeout", "1"]);
  assertEquals(run.code, FAILURE_EXIT_CODE, run.stderr);
  assertStringIncludes(run.stderr, "Timeout after 1s waiting for journal event: never.happens");
});

Deno.test("log wait without --event exits 1 and names the log command", async () => {
  const run = await runExactlInTempWorkspace(["log", "wait"]);
  assertEquals(run.code, FAILURE_EXIT_CODE, run.stderr);
  assertStringIncludes(run.stderr, "log wait requires --event <action_type>");
});

Deno.test("log verify exits 0 on the journal of a fresh workspace", async () => {
  const run = await runExactlInTempWorkspace(["log", "verify"]);
  assertEquals(run.code, 0, run.stderr);
  assertStringIncludes(run.stdout, "Journal integrity verified");
});

Deno.test("log cost exits 0 on a workspace without recorded costs", async () => {
  const run = await runExactlInTempWorkspace(["log", "cost", "--group-by", "model"]);
  assertEquals(run.code, 0, run.stderr);
});
