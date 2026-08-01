/**
 * @module FlakinessReportingTest
 * @path packages/ai/tests/providers/flakiness_reporting_test.ts
 * @description Phase 157 Step 4 — reportFlakiness scans a committed fixture set and surfaces
 *   call sites whose capture failure rate crosses
 *   DEFAULT_CAPTURE_FAILURE_PRODUCT_FINDING_THRESHOLD, naming the worst offenders. A call
 *   site the real model satisfies two times in five is technically valid and materially
 *   unrepresentative, and that must be visible rather than smoothed away.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/fixture_reports.ts, packages/ai/src/providers/capture_recording_provider.ts]
 */

import { assertEquals } from "@std/assert";
import { reportFlakiness } from "../../src/providers/fixture_reports.ts";
import type { IRecordedResponse } from "../../src/providers/mock_llm_provider.ts";

async function writeFixture(dir: string, name: string, recording: IRecordedResponse): Promise<void> {
  await Deno.writeTextFile(`${dir}/${name}.json`, JSON.stringify(recording));
}

function baseRecording(overrides: Partial<IRecordedResponse> = {}): IRecordedResponse {
  return {
    promptHash: "h",
    promptPreview: "p",
    response: "r",
    model: "claude-test-model",
    tokens: { input: 1, output: 1 },
    recordedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

Deno.test("[flakiness_reporting] a call site with a high capture-failure rate is reported, over threshold", async () => {
  const dir = await Deno.makeTempDir();
  await writeFixture(
    dir,
    "flaky",
    baseRecording({
      callSite: { scenarioId: "flows", stepId: "flaky-step", callIndex: 0 },
      capture: { attempts: 5, failures: ["a", "b", "c"] }, // 3/5 = 0.6
    }),
  );

  const summary = await reportFlakiness(dir);

  assertEquals(summary.totalFixtures, 1);
  assertEquals(summary.flakyFixtures.length, 1);
  assertEquals(summary.flakyFixtures[0].callSite, "flows/flaky-step#0");
  assertEquals(summary.flakyFixtures[0].failureRate, 0.6);
});

Deno.test("[flakiness_reporting] a fixture captured on the first attempt is not reported", async () => {
  const dir = await Deno.makeTempDir();
  await writeFixture(
    dir,
    "clean",
    baseRecording({
      callSite: { scenarioId: "flows", stepId: "clean-step", callIndex: 0 },
    }),
  );

  const summary = await reportFlakiness(dir);

  assertEquals(summary.totalFixtures, 1);
  assertEquals(summary.flakyFixtures.length, 0);
});

Deno.test("[flakiness_reporting] a custom threshold changes what counts as flaky", async () => {
  const dir = await Deno.makeTempDir();
  await writeFixture(
    dir,
    "mild",
    baseRecording({
      callSite: { scenarioId: "flows", stepId: "mild-step", callIndex: 0 },
      capture: { attempts: 4, failures: ["a"] }, // 1/4 = 0.25
    }),
  );

  const lenient = await reportFlakiness(dir, 0.5);
  const strict = await reportFlakiness(dir, 0.2);

  assertEquals(lenient.flakyFixtures.length, 0);
  assertEquals(strict.flakyFixtures.length, 1);
});

Deno.test("[flakiness_reporting] a missing directory reports an empty summary instead of throwing", async () => {
  const dir = await Deno.makeTempDir();
  const missing = `${dir}/does-not-exist`;

  const summary = await reportFlakiness(missing);

  assertEquals(summary.totalFixtures, 0);
  assertEquals(summary.flakyFixtures, []);
});

Deno.test("[flakiness_reporting] an unkeyed fixture is identified by its prompt hash", async () => {
  const dir = await Deno.makeTempDir();
  await writeFixture(
    dir,
    "unkeyed",
    baseRecording({
      promptHash: "unkeyed-hash",
      capture: { attempts: 3, failures: ["a", "b"] }, // 2/3
    }),
  );

  const summary = await reportFlakiness(dir);

  assertEquals(summary.flakyFixtures[0].callSite, "unkeyed-hash");
});
