/**
 * @module FixtureDriftTest
 * @path packages/ai/tests/providers/fixture_drift_test.ts
 * @description Phase 157 Step 1 — a call-site hit whose prompt hash no longer matches the
 *   recorded fixture still replays (the fixture may still be representative), but reports
 *   drift naming the call site so a human can decide whether to re-capture. An unchanged
 *   prompt reports nothing. This is what keeps a prompt edit from turning into a wall of
 *   `strictRecordings` failures.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/mock_llm_provider.ts]
 */

import { assertEquals } from "@std/assert";
import { MockStrategy } from "@exaix/core";
import type { ICallSite } from "../../src/types.ts";
import { type IRecordedResponse, MockLLMProvider } from "../../src/providers/mock_llm_provider.ts";
import { TEST_MODEL_ANTHROPIC } from "@exaix/testing";

Deno.test("[fixture_drift] a changed prompt still replays the recorded response, and reports drift naming the call site", async () => {
  const callSite: ICallSite = { scenarioId: "flow_blueprints", stepId: "step-2", callIndex: 0 };
  const recordings: IRecordedResponse[] = [{
    promptHash: "stale-hash-that-will-not-match",
    promptPreview: "old preview",
    response: "the recorded response",
    model: TEST_MODEL_ANTHROPIC,
    tokens: { input: 1, output: 1 },
    recordedAt: "2026-01-01T00:00:00Z",
    callSite,
  }];
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings, patterns: [] });

  const result = await provider.generate("a new prompt whose hash will not match the fixture", { callSite });

  assertEquals(result.content, "the recorded response", "drift still replays the stale recording");
  assertEquals(provider.driftReports.length, 1);
  assertEquals(provider.driftReports[0].callSite, callSite);
  assertEquals(provider.driftReports[0].expectedHash, "stale-hash-that-will-not-match");
});

Deno.test("[fixture_drift] an unchanged prompt reports no drift", async () => {
  const callSite: ICallSite = { scenarioId: "flow_blueprints", stepId: "step-3", callIndex: 0 };
  const prompt = "the exact recorded prompt";

  // hashPrompt is a pure function of the prompt string; any instance computes the same value.
  const hasher = new MockLLMProvider(MockStrategy.RECORDED, { recordings: [], patterns: [] });
  const promptHash = hasher.hashPrompt(prompt);

  const recordings: IRecordedResponse[] = [{
    promptHash,
    promptPreview: prompt,
    response: "current response",
    model: TEST_MODEL_ANTHROPIC,
    tokens: { input: 1, output: 1 },
    recordedAt: "2026-01-01T00:00:00Z",
    callSite,
  }];
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings, patterns: [] });

  const result = await provider.generate(prompt, { callSite });

  assertEquals(result.content, "current response");
  assertEquals(provider.driftReports.length, 0);
});

Deno.test("[fixture_drift] driftReports accumulates across multiple drifted calls", async () => {
  const siteA: ICallSite = { scenarioId: "flow_blueprints", stepId: "step-a", callIndex: 0 };
  const siteB: ICallSite = { scenarioId: "flow_blueprints", stepId: "step-b", callIndex: 0 };
  const recordings: IRecordedResponse[] = [
    {
      promptHash: "stale-a",
      promptPreview: "a",
      response: "response a",
      model: TEST_MODEL_ANTHROPIC,
      tokens: { input: 1, output: 1 },
      recordedAt: "2026-01-01T00:00:00Z",
      callSite: siteA,
    },
    {
      promptHash: "stale-b",
      promptPreview: "b",
      response: "response b",
      model: TEST_MODEL_ANTHROPIC,
      tokens: { input: 1, output: 1 },
      recordedAt: "2026-01-01T00:00:00Z",
      callSite: siteB,
    },
  ];
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings, patterns: [] });

  await provider.generate("changed prompt a", { callSite: siteA });
  await provider.generate("changed prompt b", { callSite: siteB });

  assertEquals(provider.driftReports.length, 2);
});
