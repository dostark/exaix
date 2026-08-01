/**
 * @module ScenarioFrameworkReportCaptureFlakinessTest
 * @path tests/scenario_framework/tests/unit/report_capture_flakiness_test.ts
 * @description Phase 157 Step 4 — after a --capture-fixtures run, reportCaptureFlakiness
 *   scans the captured directory and prints a summary naming any call site whose capture
 *   failure rate crosses the product-finding threshold, reusing packages/ai's reportFlakiness
 *   rather than re-implementing fixture-scanning in the runner.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/capture_fixtures_flag.ts, tests/scenario_framework/runner/main.ts]
 */

import { assertStringIncludes } from "@std/assert";
import { reportCaptureFlakiness } from "../../runner/capture_fixtures_flag.ts";

Deno.test("[report_capture_flakiness] prints a warning naming a flaky call site", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/flows__flaky-step__0.json`,
    JSON.stringify({
      promptHash: "h",
      promptPreview: "p",
      response: "r",
      model: "claude-test-model",
      tokens: { input: 1, output: 1 },
      recordedAt: "2026-01-01T00:00:00Z",
      callSite: { scenarioId: "flows", stepId: "flaky-step", callIndex: 0 },
      capture: { attempts: 5, failures: ["a", "b", "c"] },
    }),
  );

  const originalWarn = console.warn;
  const lines: string[] = [];
  console.warn = (msg: string) => {
    lines.push(msg);
  };
  try {
    await reportCaptureFlakiness(dir);
  } finally {
    console.warn = originalWarn;
  }

  assertStringIncludes(lines.join("\n"), "flows/flaky-step#0");
});

Deno.test("[report_capture_flakiness] prints nothing when no fixture is flaky", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/flows__clean-step__0.json`,
    JSON.stringify({
      promptHash: "h",
      promptPreview: "p",
      response: "r",
      model: "claude-test-model",
      tokens: { input: 1, output: 1 },
      recordedAt: "2026-01-01T00:00:00Z",
      callSite: { scenarioId: "flows", stepId: "clean-step", callIndex: 0 },
    }),
  );

  const originalWarn = console.warn;
  let called = false;
  console.warn = () => {
    called = true;
  };
  try {
    await reportCaptureFlakiness(dir);
  } finally {
    console.warn = originalWarn;
  }

  if (called) throw new Error("console.warn must not be called when nothing is flaky");
});
