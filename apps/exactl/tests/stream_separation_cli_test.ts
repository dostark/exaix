/**
 * @module StreamSeparationCliTest
 * @path apps/exactl/tests/stream_separation_cli_test.ts
 * @description Runs the real exactl binary to check that data goes to stdout, display lines and failures go to stderr, and a failure has a JSON shape.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/init.ts, apps/exactl/src/exactl_error_handler.ts]
 */

import { assertEquals, assertNotMatch, assertStringIncludes } from "@std/assert";
import { ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { runExactlSequenceInTempWorkspace } from "./helpers/exactl_cli_process.ts";

const MISSING_MODEL = "anthropic/none";
const DISPLAY_LINE = `No service serves ${MISSING_MODEL}.`;

Deno.test("model list -o json stdout parses as JSON while stderr carries the display line", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["model", "list", "--model", MISSING_MODEL, "-o", "json"]]);
  assertEquals(run.code, 0, run.stderr);
  assertEquals(JSON.parse(run.stdout), []);
  assertStringIncludes(run.stderr, DISPLAY_LINE);
});

Deno.test("model list in a human format keeps the display line off stdout", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["model", "list", "--model", MISSING_MODEL]]);
  assertEquals(run.code, 0, run.stderr);
  assertNotMatch(run.stdout, /No service serves/);
  assertStringIncludes(run.stderr, DISPLAY_LINE);
});

Deno.test("a not-found cancel with --json prints the JSON error on stderr and nothing on stdout", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["request", "cancel", "missing-trace", "--json", "--yes"]]);
  assertEquals(run.code, ExaCtlExitCode.NOT_FOUND);
  assertEquals(run.stdout, "");
  assertEquals(JSON.parse(run.stderr.trim().split("\n").pop() ?? "{}").error.code, "NOT_FOUND");
});

Deno.test("an unknown option with -o json prints a USAGE JSON error and exits 2", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["plan", "list", "--bogus-option", "-o", "json"]]);
  assertEquals(run.code, ExaCtlExitCode.USAGE);
  assertEquals(run.stdout, "");
  assertEquals(JSON.parse(run.stderr.trim().split("\n").pop() ?? "{}").error.code, "USAGE");
});
