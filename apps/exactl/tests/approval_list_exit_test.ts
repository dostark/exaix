/**
 * @module ApprovalListExitTest
 * @path apps/exactl/tests/approval_list_exit_test.ts
 * @description Verifies that `approval list` ends the process after it printed the rows when a source timed out, although that source still holds an open handle.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, apps/exactl/tests/helpers/approval_hang_probe.ts]
 * @related-files [apps/exactl/src/command_builders/approval_command.ts, apps/exactl/src/commands/approval_commands.ts]
 */

import { assertEquals, assertNotMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..");
const PROBE = join(REPO_ROOT, "apps", "exactl", "tests", "helpers", "approval_hang_probe.ts");
/** A safety net only: a probe that hangs is killed, so the test fails instead of hanging. */
const HANG_GUARD_MS = 20_000;
const SUCCESS_EXIT_CODE = 0;
const TEMP_DIR_MARKER = "TEMP:";
const PROBE_DONE_MARKER = "PROBE_DONE";
const PROBE_PLAN_REF = "plan:probe-plan";

Deno.test("approval list exits after printing the rows when a source timed out and still holds an open handle", async () => {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "--config", join(REPO_ROOT, "deno.json"), PROBE],
    env: { EXA_TEST_CLI_MODE: "1" },
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const guard = setTimeout(() => child.kill("SIGKILL"), HANG_GUARD_MS);
  const output = await child.output();
  clearTimeout(guard);
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  const tempDir = stdout.split("\n").find((line) => line.startsWith(TEMP_DIR_MARKER))?.slice(TEMP_DIR_MARKER.length);
  try {
    assertEquals(output.code, SUCCESS_EXIT_CODE, `the probe did not exit by itself:\n${stderr}`);
    assertStringIncludes(stdout, PROBE_PLAN_REF);
    assertStringIncludes(stderr, "review approvals unavailable: timed out");
    assertNotMatch(stdout, new RegExp(PROBE_DONE_MARKER), "the command must end the process before the script goes on");
  } finally {
    if (tempDir !== undefined) await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
