/**
 * @module RefreshUpdatesAddressedFixturesTest
 * @path packages/ai/tests/providers/refresh_updates_addressed_fixtures_test.ts
 * @description Phase 157 Step 4 — re-capturing after a prompt change updates ONLY the
 *   addressed call site's fixture; a sibling fixture in the same directory is left
 *   byte-identical. This is what makes "refresh is one command with a reviewable diff" true
 *   — the diff is scoped to what actually changed, not the whole set.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/capture_recording_provider.ts]
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { CaptureRecordingProvider } from "../../src/providers/capture_recording_provider.ts";
import type { ICallSite, IModelOptions, IModelProvider } from "../../src/types.ts";
import type { IGenerateResult } from "../../src/providers/common.ts";

const FLOW_STEP_PROMPT = "## Step 1\nContext from the prior step.";

function okResult(content: string): IGenerateResult {
  return {
    content,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: "claude-test-model",
    provider: "stub",
  };
}

class FixedResponseProvider implements IModelProvider {
  readonly id = "stub";
  constructor(private readonly response: string) {}
  generate(_prompt: string, _options?: IModelOptions): Promise<IGenerateResult> {
    return Promise.resolve(okResult(this.response));
  }
}

async function readFixture(dir: string, callSite: ICallSite): Promise<string> {
  return await Deno.readTextFile(`${dir}/${callSite.scenarioId}__${callSite.stepId}__${callSite.callIndex}.json`);
}

Deno.test("[refresh_updates_addressed_fixtures] re-capturing one call site leaves a sibling fixture untouched", async () => {
  const dir = await Deno.makeTempDir();
  const siteA: ICallSite = { scenarioId: "flows", stepId: "a", callIndex: 0 };
  const siteB: ICallSite = { scenarioId: "flows", stepId: "b", callIndex: 0 };
  const original = `<content>\n{"subject": "original", "steps": []}\n</content>`;

  const first = new CaptureRecordingProvider(new FixedResponseProvider(original), { dir });
  await first.generate(FLOW_STEP_PROMPT, { callSite: siteA });
  await first.generate(FLOW_STEP_PROMPT, { callSite: siteB });

  const siteBBefore = await readFixture(dir, siteB);

  const refreshed = `<content>\n{"subject": "refreshed after a prompt change", "steps": []}\n</content>`;
  const second = new CaptureRecordingProvider(new FixedResponseProvider(refreshed), { dir });
  await second.generate(FLOW_STEP_PROMPT, { callSite: siteA });

  const siteAAfter = await readFixture(dir, siteA);
  const siteBAfter = await readFixture(dir, siteB);

  assertEquals(JSON.parse(siteAAfter).response, refreshed, "the addressed call site must update");
  assertEquals(siteBAfter, siteBBefore, "a sibling fixture must be left byte-identical");
  assertNotEquals(siteAAfter, siteBAfter);
});
