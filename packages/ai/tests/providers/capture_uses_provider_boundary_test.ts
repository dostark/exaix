/**
 * @module CaptureUsesProviderBoundaryTest
 * @path packages/ai/tests/providers/capture_uses_provider_boundary_test.ts
 * @description Phase 157 Step 2 — capture observes `generate` calls through the IModelProvider
 *   boundary (a decorator around the live provider), never the journal. Proven two ways:
 *   CaptureRecordingProvider has no logger/journal dependency in its constructor at all (there
 *   is nothing for it to read events from), and it works purely by delegating to whatever
 *   IModelProvider it wraps — proven here with a scripted stub, no live model or credentials.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/capture_recording_provider.ts]
 */

import { assertEquals } from "@std/assert";
import { CaptureRecordingProvider } from "../../src/providers/capture_recording_provider.ts";
import type { ICallSite, IModelOptions, IModelProvider } from "../../src/types.ts";
import type { IGenerateResult } from "../../src/providers/common.ts";

const FLOW_STEP_PROMPT = "## Step 1\nContext from the prior step.";
const WELL_FORMED = `<content>\n{"subject": "x", "steps": []}\n</content>`;

class StubProvider implements IModelProvider {
  readonly id = "stub-provider";
  observedCalls: { prompt: string; options?: IModelOptions }[] = [];
  generate(prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
    this.observedCalls.push({ prompt, options });
    return Promise.resolve({
      content: WELL_FORMED,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: "claude-test-model",
      provider: this.id,
    });
  }
}

Deno.test("[capture_uses_provider_boundary] the constructor takes no logger/journal dependency", () => {
  // Two positional args only: the inner provider and its own options — nothing that could
  // read journal/DEBUG events. If this ever grows a logger param, that IS the regression this
  // test exists to catch.
  assertEquals(CaptureRecordingProvider.length, 2);
});

Deno.test("[capture_uses_provider_boundary] capture observes the generate call at the provider boundary, via a stub", async () => {
  const dir = await Deno.makeTempDir();
  const stub = new StubProvider();
  const capture = new CaptureRecordingProvider(stub, { dir });
  const callSite: ICallSite = { scenarioId: "flows", stepId: "a", callIndex: 0 };

  await capture.generate(FLOW_STEP_PROMPT, { callSite });

  assertEquals(stub.observedCalls.length, 1);
  assertEquals(stub.observedCalls[0].prompt, FLOW_STEP_PROMPT);
  assertEquals(stub.observedCalls[0].options?.callSite, callSite);
});
