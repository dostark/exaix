/**
 * @module FixtureAddressingTest
 * @path packages/ai/tests/providers/fixture_addressing_test.ts
 * @description Phase 157 Step 1 — recorded-strategy lookup resolves by call site (scenario,
 *   step, call index) rather than by prompt content, so a fixture is found regardless of the
 *   exact prompt wording. Also pins the regression contract: a call with no `callSite` in
 *   options behaves byte-identically to the pre-Phase-157 whole-prompt-hash lookup.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/mock_llm_provider.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { MockStrategy } from "@exaix/core";
import type { ICallSite } from "../../src/types.ts";
import { type IRecordedResponse, MockLLMError, MockLLMProvider } from "../../src/providers/mock_llm_provider.ts";
import { TEST_MODEL_ANTHROPIC } from "@exaix/testing";

Deno.test("[fixture_addressing] resolves a recording by call site, regardless of prompt wording", async () => {
  const callSite: ICallSite = { scenarioId: "flow_blueprints", stepId: "step-1", callIndex: 0 };
  const recordings: IRecordedResponse[] = [{
    promptHash: "some-hash-that-will-not-match-the-new-prompt",
    promptPreview: "original prompt preview",
    response: "recorded response for step 1",
    model: TEST_MODEL_ANTHROPIC,
    tokens: { input: 10, output: 10 },
    recordedAt: "2026-01-01T00:00:00Z",
    callSite,
  }];
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings, patterns: [] });

  const result = await provider.generate("a completely different prompt wording", { callSite });

  assertEquals(result.content, "recorded response for step 1");
});

Deno.test("[fixture_addressing] a different call index at the same scenario/step is a distinct fixture", async () => {
  const siteZero: ICallSite = { scenarioId: "flow_blueprints", stepId: "step-1", callIndex: 0 };
  const siteOne: ICallSite = { scenarioId: "flow_blueprints", stepId: "step-1", callIndex: 1 };
  const recordings: IRecordedResponse[] = [
    {
      promptHash: "h0",
      promptPreview: "p0",
      response: "response for call 0",
      model: TEST_MODEL_ANTHROPIC,
      tokens: { input: 1, output: 1 },
      recordedAt: "2026-01-01T00:00:00Z",
      callSite: siteZero,
    },
    {
      promptHash: "h1",
      promptPreview: "p1",
      response: "response for call 1",
      model: TEST_MODEL_ANTHROPIC,
      tokens: { input: 1, output: 1 },
      recordedAt: "2026-01-01T00:00:00Z",
      callSite: siteOne,
    },
  ];
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings, patterns: [] });

  const first = await provider.generate("prompt for the first call", { callSite: siteZero });
  const second = await provider.generate("prompt for the second call", { callSite: siteOne });

  assertEquals(first.content, "response for call 0");
  assertEquals(second.content, "response for call 1");
});

Deno.test("[fixture_addressing] a recording keyed for a different step is not returned", async () => {
  const recordings: IRecordedResponse[] = [{
    promptHash: "h",
    promptPreview: "p",
    response: "wrong step's response",
    model: TEST_MODEL_ANTHROPIC,
    tokens: { input: 1, output: 1 },
    recordedAt: "2026-01-01T00:00:00Z",
    callSite: { scenarioId: "flow_blueprints", stepId: "other-step", callIndex: 0 },
  }];
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings,
    patterns: [],
    strictRecordings: true,
  });

  await assertRejects(
    async () =>
      await provider.generate("anything", {
        callSite: { scenarioId: "flow_blueprints", stepId: "this-step", callIndex: 0 },
      }),
    MockLLMError,
  );
});

Deno.test("[regression] with no callSite in options, recorded strategy behaves exactly as before (whole-prompt-hash lookup)", async () => {
  const recordings: IRecordedResponse[] = [{
    promptHash: "abc123",
    promptPreview: "You are a senior...",
    response: "## Plan\n\n1. First step",
    model: TEST_MODEL_ANTHROPIC,
    tokens: { input: 100, output: 50 },
    recordedAt: "2025-12-01T10:00:00Z",
  }];
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings });

  const result = await provider.generate("You are a senior...");

  assertEquals(result.content, "## Plan\n\n1. First step");
  assertEquals(provider.driftReports.length, 0);
});
