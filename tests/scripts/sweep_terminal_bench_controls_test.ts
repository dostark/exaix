/**
 * @module SweepTerminalBenchControlsTest
 * @path tests/scripts/sweep_terminal_bench_controls_test.ts
 * @description RED-first tests, Phase 144 post-gap remediation (GAP-2 / Step 8). `runCommand`
 *   is used for both quick local `git` calls and the jailed `docker run` verify invocation
 *   against externally-sourced, untrusted Terminal-Bench task content — before this
 *   remediation it had no timeout at all, so a hung or pathologically slow task could block
 *   the controls sweep indefinitely. `runCommand` must kill the child at a bounded timeout
 *   and return a diagnosable, non-throwing result rather than hanging or crashing the sweep.
 * @architectural-layer Test
 * @related-files [scripts/sweep_terminal_bench_controls.ts, scripts/ingest_terminal_bench.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runCommand, sweepTask } from "../../scripts/sweep_terminal_bench_controls.ts";

Deno.test("[SweepTerminalBenchControls] runCommand kills a hung process at the timeout and returns a diagnosable non-zero result, never hanging", async () => {
  const start = Date.now();
  const result = await runCommand("sleep", ["30"], undefined, 200);
  const elapsedMs = Date.now() - start;

  assert(
    elapsedMs < 5000,
    `must kill the hung process near its 200ms timeout, not wait the full 30s: took ${elapsedMs}ms`,
  );
  assertEquals(result.code === 0, false, "a killed process must never report success");
  assert(
    result.stderr.includes("verify timed out after 200ms"),
    `must record a diagnosable timeout reason: ${result.stderr}`,
  );
});

Deno.test("[SweepTerminalBenchControls] runCommand completes normally, well under the timeout, for a fast command", async () => {
  const result = await runCommand("true", [], undefined, 5000);
  assertEquals(result.code, 0);
});

Deno.test("[SweepTerminalBenchControls] sweepTask contains a malformed task.json as a sweep-error result instead of throwing (GAP-3)", async () => {
  const fixturesDir = await Deno.makeTempDir({ prefix: "exaix-tb-sweep-fixtures-" });
  const portalsDir = await Deno.makeTempDir({ prefix: "exaix-tb-sweep-portals-" });
  try {
    const contractDir = join(fixturesDir, "bad-task");
    await Deno.mkdir(contractDir, { recursive: true });
    await Deno.writeTextFile(join(contractDir, "task.json"), "{ this is not valid json");

    const outcome = await sweepTask(
      { task_id: "bad-task", class: "supported", controls_status: "pending" },
      fixturesDir,
      portalsDir,
    );

    assertEquals(outcome.taskId, "bad-task");
    assertEquals(outcome.status, "fail");
    assert(
      outcome.detail.startsWith("sweep-error:"),
      `a malformed task.json must be contained as a sweep-error result, not thrown: ${outcome.detail}`,
    );
  } finally {
    await Deno.remove(fixturesDir, { recursive: true });
    await Deno.remove(portalsDir, { recursive: true });
  }
});
