/**
 * @module TestParallelRunnerTest
 * @path tests/scripts/test_parallel_test.ts
 * @description Verifies reporter parsing for the custom parallel test runner.
 */

import { assertEquals, assertMatch, assertThrows } from "@std/assert";

import {
  buildDenoTestArgs,
  compactDotReporterChunk,
  createDotReporterState,
  DOT_REPORTER_LEGEND,
  flushDotReporterState,
  formatRunHeader,
  killActiveChildGroups,
  parseSummaryLine,
  resolveReporter,
  stripReporterArgs,
} from "../../scripts/test_parallel.ts";

Deno.test("resolveReporter defaults to pretty output", () => {
  assertEquals(resolveReporter([]), "pretty");
});

Deno.test("resolveReporter accepts equals-form reporter flag", () => {
  assertEquals(resolveReporter(["--reporter=dot"]), "dot");
});

Deno.test("resolveReporter accepts spaced reporter flag", () => {
  assertEquals(resolveReporter(["--reporter", "pretty"]), "pretty");
});

Deno.test("resolveReporter rejects unsupported reporters", () => {
  assertThrows(() => resolveReporter(["--reporter=tap"]), Error, "Unsupported reporter");
});

Deno.test("buildDenoTestArgs injects the requested reporter", () => {
  assertEquals(buildDenoTestArgs(["--parallel"], "dot"), [
    "test",
    "--allow-all",
    "--reporter",
    "dot",
    "--parallel",
  ]);
});

Deno.test("stripReporterArgs preserves non-reporter flags", () => {
  assertEquals(stripReporterArgs(["--reporter=dot", "--filter", "flow", "--parallel"]), [
    "--filter",
    "flow",
    "--parallel",
  ]);
});

Deno.test("formatRunHeader renders compact sequential header", () => {
  assertEquals(
    formatRunHeader("Batch 2 – 24_portal_e2e_workflow_test.ts", true),
    "\n› 24_portal_e2e_workflow_test.ts",
  );
});

Deno.test("formatRunHeader renders compact batch one header", () => {
  assertEquals(formatRunHeader("Batch 1 – Parallel suite"), "› Parallel suite");
});

Deno.test("DOT_REPORTER_LEGEND documents symbol meanings", () => {
  assertEquals(DOT_REPORTER_LEGEND, "dot legend: .=passed ,=ignored !=failed");
});

Deno.test("compactDotReporterChunk keeps passing dots on one line", () => {
  const state = createDotReporterState();

  assertEquals(compactDotReporterChunk(".\n.\n.\n", state), "");
  assertEquals(
    compactDotReporterChunk("ok | 3 passed | 0 failed (1ms)\n", state),
    "...ok | 3 passed | 0 failed (1ms)\n",
  );
  assertEquals(flushDotReporterState(state), "");
});

Deno.test("compactDotReporterChunk handles split chunks before flushing", () => {
  const state = createDotReporterState();

  assertEquals(compactDotReporterChunk(".\n.\n", state), "");
  assertEquals(compactDotReporterChunk(".", state), "");
  assertEquals(flushDotReporterState(state), "...\n");
});

Deno.test("compactDotReporterChunk keeps ignored commas with pass dots", () => {
  const state = createDotReporterState();

  assertEquals(compactDotReporterChunk(".\n,\n.\n", state), "");
  assertEquals(
    compactDotReporterChunk("ok | 2 passed | 0 failed | 1 ignored (1ms)\n", state),
    ".,.ok | 2 passed | 0 failed | 1 ignored (1ms)\n",
  );
  assertEquals(flushDotReporterState(state), "");
});

Deno.test("compactDotReporterChunk flushes once it reaches terminal width", () => {
  const state = createDotReporterState(3);

  assertEquals(compactDotReporterChunk(".\n,\n.\n", state), ".,.\n");
  assertEquals(flushDotReporterState(state), "");
});

// killActiveChildGroups: orphan-prevention on external kill (SIGINT/SIGTERM/timeout).
// Root cause: killing test_parallel.ts's top-level process does NOT cascade to a `deno test`
// child's own children on Linux, so signaling the negative (process-group) pid is required.

Deno.test("[killActiveChildGroups] signals every tracked pid as a negative (process-group) target", () => {
  const signaled: number[] = [];
  killActiveChildGroups([111, 222, 333], (pid) => signaled.push(pid));
  assertEquals(signaled, [-111, -222, -333]);
});

Deno.test("[killActiveChildGroups] a throw from one pid's kill does not stop the rest", () => {
  const signaled: number[] = [];
  killActiveChildGroups([111, 222, 333], (pid) => {
    signaled.push(pid);
    if (pid === -222) throw new Error("ESRCH: No such process");
  });
  assertEquals(signaled, [-111, -222, -333]);
});

Deno.test("[killActiveChildGroups] an empty pid set signals nothing (no-op, never throws)", () => {
  const signaled: number[] = [];
  killActiveChildGroups([], (pid) => signaled.push(pid));
  assertEquals(signaled, []);
});

Deno.test("parseSummaryLine handles failed batch summaries with step counts", () => {
  const summaryLine = "FAILED | 4420 passed (966 steps) | 1 failed (1 step) | 12 ignored (1m21s)";

  assertMatch(
    summaryLine,
    /^(?:ok|FAILED)\s*\|\s*\d+\s+passed(?:\s*\(\d+\s+steps?\))?\s*\|\s*\d+\s+failed(?:\s*\(\d+\s+steps?\))?(?:\s*\|\s*\d+\s+ignored)?\s*\((?:\d+ms|\d+s|\d+m\d+s)\)$/,
  );

  assertEquals(
    parseSummaryLine(summaryLine),
    {
      passed: 4420,
      failed: 1,
      ignored: 12,
      durationSec: 81,
    },
  );
});
