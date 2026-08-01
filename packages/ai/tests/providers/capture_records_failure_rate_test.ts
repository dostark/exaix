/**
 * @module CaptureRecordsFailureRateTest
 * @path packages/ai/tests/providers/capture_records_failure_rate_test.ts
 * @description Phase 157 Step 2 — a call site that needed retries to satisfy its contract
 *   records the attempts and failure reasons on the written fixture (IRecordedResponse.capture).
 *   Retrying without recording turns a flaky call site into a fixture set that is greener than
 *   reality (Design Decision 3 / R7).
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/capture_recording_provider.ts]
 */

import { assertEquals } from "@std/assert";
import { CaptureRecordingProvider } from "../../src/providers/capture_recording_provider.ts";
import type { ICallSite, IModelOptions, IModelProvider } from "../../src/types.ts";
import type { IGenerateResult } from "../../src/providers/common.ts";
import type { IRecordedResponse } from "../../src/providers/mock_llm_provider.ts";

const FLOW_STEP_PROMPT = "## Step 1\nContext from the prior step.";
const WELL_FORMED = `<content>\n{"subject": "x", "steps": []}\n</content>`;

function okResult(content: string): IGenerateResult {
  return {
    content,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    model: "claude-test-model",
    provider: "stub",
  };
}

/** Fails its first N calls with malformed content, then succeeds. */
class FlakyProvider implements IModelProvider {
  readonly id = "stub";
  callCount = 0;
  constructor(private readonly failuresBeforeSuccess: number) {}
  generate(_prompt: string, _options?: IModelOptions): Promise<IGenerateResult> {
    this.callCount++;
    if (this.callCount <= this.failuresBeforeSuccess) {
      return Promise.resolve(okResult("malformed, no required markers"));
    }
    return Promise.resolve(okResult(WELL_FORMED));
  }
}

async function readFixture(dir: string): Promise<IRecordedResponse> {
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      return JSON.parse(await Deno.readTextFile(`${dir}/${entry.name}`));
    }
  }
  throw new Error("no fixture written");
}

Deno.test("[capture_records_failure_rate] a call site needing retries records attempts and failures on the fixture", async () => {
  const dir = await Deno.makeTempDir();
  const flaky = new FlakyProvider(2);
  const capture = new CaptureRecordingProvider(flaky, { dir, maxAttempts: 5 });
  const callSite: ICallSite = { scenarioId: "flows", stepId: "a", callIndex: 0 };

  await capture.generate(FLOW_STEP_PROMPT, { callSite });

  assertEquals(flaky.callCount, 3);
  const fixture = await readFixture(dir);
  assertEquals(fixture.capture?.attempts, 3);
  assertEquals(fixture.capture?.failures.length, 2);
});

Deno.test("[capture_records_failure_rate] a call site captured on the first attempt carries no capture metadata", async () => {
  const dir = await Deno.makeTempDir();
  const capture = new CaptureRecordingProvider(new FlakyProvider(0), { dir, maxAttempts: 5 });
  const callSite: ICallSite = { scenarioId: "flows", stepId: "b", callIndex: 0 };

  await capture.generate(FLOW_STEP_PROMPT, { callSite });

  const fixture = await readFixture(dir);
  assertEquals(fixture.capture, undefined);
});
