/**
 * @module DriveInteractiveRoundTest
 * @path tests/scenario_framework/tests/unit/drive_interactive_round_test.ts
 * @description Unit tests for `drive_interactive_round.ts`'s pure JSON-parsing helpers, plus an
 *   integration-style test of `main()` against a fake `exactl` executable that mimics
 *   `request clarify`'s real `--json` output shape (including the diagnostic-line prefix
 *   `CliDelegateModelProvider` prints to stdout on a real provider call). Phase 145 Step 5
 *   (declarative-purity migration — see `scripts/check_scenario_declarative.ts`).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/drive_interactive_round.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { extractFirstQuestionId, main, stripDiagnosticPrefix } from "../../runner/drive_interactive_round.ts";

Deno.test("[DriveInteractiveRound] stripDiagnosticPrefix removes lines before the JSON opening brace", () => {
  const raw =
    '[CliDelegateModelProvider] generate start: model=x\n[CliDelegateModelProvider] generate exited: code=0\n{"status":"questions"}';
  assertEquals(stripDiagnosticPrefix(raw), '{"status":"questions"}');
});

Deno.test("[DriveInteractiveRound] stripDiagnosticPrefix is a no-op when there is no diagnostic prefix", () => {
  const raw = '{"status":"complete"}';
  assertEquals(stripDiagnosticPrefix(raw), '{"status":"complete"}');
});

Deno.test("[DriveInteractiveRound] extractFirstQuestionId reads questions[0].id from clarify JSON", () => {
  const raw = '{"status":"questions","questions":[{"id":"r1q1","question":"What?"}]}';
  assertEquals(extractFirstQuestionId(raw), "r1q1");
});

Deno.test("[DriveInteractiveRound] extractFirstQuestionId throws when there are no pending questions", () => {
  assertThrows(
    () => extractFirstQuestionId('{"status":"complete"}'),
    Error,
    "no pending questions",
  );
});

/** A fake `exactl` executable mimicking `request clarify`'s real dispatch, prefixed with the
 *  same diagnostic line the real `CliDelegateModelProvider` prints to stdout. */
async function makeFakeExactl(dir: string): Promise<string> {
  const path = join(dir, "fake-exactl");
  await Deno.writeTextFile(
    path,
    [
      "#!/bin/sh",
      'DIAG="[CliDelegateModelProvider] generate start: model=x"',
      'case "$*" in',
      '  *--proceed*) echo "$DIAG"; echo \'{"status":"complete"}\' ;;',
      '  *--answer*) echo "$DIAG"; echo \'{"status":"questions","round":2,"questions":[{"id":"r2q1","question":"More?"}]}\' ;;',
      '  *) echo "$DIAG"; echo \'{"status":"questions","round":1,"questions":[{"id":"r1q1","question":"What?"}]}\' ;;',
      "esac",
    ].join("\n"),
  );
  await Deno.chmod(path, 0o755);
  return path;
}

Deno.test("[DriveInteractiveRound] main() drives a full round through a fake exactl and writes the answer result", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const fakeExactl = await makeFakeExactl(dir);
    const outputPath = join(dir, "clarify-round-result.json");
    const code = await main([fakeExactl, "req-test-1", "A specific answer.", "user-simulator:cooperative", outputPath]);
    assertEquals(code, 0);

    const written = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(written.status, "questions");
    assertEquals(written.round, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[DriveInteractiveRound] main() also forces a terminal resolution via --proceed after recording the answer round", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const fakeExactl = await makeFakeExactl(dir);
    const callsLogPath = join(dir, "calls.log");
    // Wrap the fake exactl to also append each invocation's args to a log file, so this test
    // can assert --proceed was really called (not just that main() returned 0).
    const wrapperPath = join(dir, "fake-exactl-logging");
    await Deno.writeTextFile(
      wrapperPath,
      [
        "#!/bin/sh",
        `echo "$*" >> "${callsLogPath}"`,
        `exec "${fakeExactl}" "$@"`,
      ].join("\n"),
    );
    await Deno.chmod(wrapperPath, 0o755);

    const outputPath = join(dir, "clarify-round-result.json");
    const code = await main([wrapperPath, "req-test-2", "An answer.", "user-simulator:cooperative", outputPath]);
    assertEquals(code, 0);

    const calls = await Deno.readTextFile(callsLogPath);
    assertEquals(calls.includes("--proceed"), true);
    assertEquals(calls.includes("--answer"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[DriveInteractiveRound] exits 2 on missing arguments", async () => {
  const code = await main(["/bin/true", "req-1"]);
  assertEquals(code, 2);
});
