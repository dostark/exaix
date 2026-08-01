/**
 * @module CaptureReplayRoundtripTest
 * @path packages/ai/tests/providers/capture_replay_roundtrip_test.ts
 * @description Phase 157 Step 2 — a fixture set written by CaptureRecordingProvider replays,
 *   through MockLLMProvider's call-site lookup (Step 1), to the exact same responses that were
 *   captured. This is the round trip the whole fixture tier depends on.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/capture_recording_provider.ts, packages/ai/src/providers/mock_llm_provider.ts]
 */

import { assertEquals } from "@std/assert";
import { MockStrategy } from "@exaix/core";
import { CaptureRecordingProvider } from "../../src/providers/capture_recording_provider.ts";
import { MockLLMProvider } from "../../src/providers/mock_llm_provider.ts";
import type { ICallSite, IModelOptions, IModelProvider } from "../../src/types.ts";
import type { IGenerateResult } from "../../src/providers/common.ts";

const FLOW_STEP_PROMPT_A = "## Step 1\nFirst step's context.";
const FLOW_STEP_PROMPT_B = "## Step 1\nSecond step's context.";
const RESPONSE_A = `<content>\n{"subject": "a", "steps": []}\n</content>`;
const RESPONSE_B = `<content>\n{"subject": "b", "steps": []}\n</content>`;

class MapProvider implements IModelProvider {
  readonly id = "stub";
  constructor(private readonly byPrompt: Map<string, string>) {}
  generate(prompt: string, _options?: IModelOptions): Promise<IGenerateResult> {
    const content = this.byPrompt.get(prompt);
    if (!content) throw new Error(`no scripted response for prompt: ${prompt}`);
    return Promise.resolve({
      content,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: "claude-test-model",
      provider: this.id,
    });
  }
}

Deno.test("[capture_replay_roundtrip] a captured fixture set replays to the same responses it captured", async () => {
  const dir = await Deno.makeTempDir();
  const capture = new CaptureRecordingProvider(
    new MapProvider(new Map([[FLOW_STEP_PROMPT_A, RESPONSE_A], [FLOW_STEP_PROMPT_B, RESPONSE_B]])),
    { dir },
  );

  const siteA: ICallSite = { scenarioId: "flows", stepId: "step-a", callIndex: 0 };
  const siteB: ICallSite = { scenarioId: "flows", stepId: "step-b", callIndex: 0 };
  await capture.generate(FLOW_STEP_PROMPT_A, { callSite: siteA });
  await capture.generate(FLOW_STEP_PROMPT_B, { callSite: siteB });

  const replay = new MockLLMProvider(MockStrategy.RECORDED, { fixtureDir: dir, patterns: [], strictRecordings: true });

  const resultA = await replay.generate("completely different wording, same call site", { callSite: siteA });
  const resultB = await replay.generate("also different wording", { callSite: siteB });

  assertEquals(resultA.content, RESPONSE_A);
  assertEquals(resultB.content, RESPONSE_B);
});
