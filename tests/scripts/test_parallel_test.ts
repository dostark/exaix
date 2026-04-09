/**
 * @module TestParallelRunnerTest
 * @path tests/scripts/test_parallel_test.ts
 * @description Verifies reporter parsing for the custom parallel test runner.
 */

import { assertEquals, assertThrows } from "@std/assert";

import {
  buildDenoTestArgs,
  compactDotReporterChunk,
  createDotReporterState,
  DOT_REPORTER_LEGEND,
  flushDotReporterState,
  formatRunHeader,
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
