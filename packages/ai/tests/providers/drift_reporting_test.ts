/**
 * @module DriftReportingTest
 * @path packages/ai/tests/providers/drift_reporting_test.ts
 * @description Phase 157 Step 4 — MockLLMProvider.reportDrift() surfaces accumulated drift
 *   with counts per fixture set, and flags when the drift rate crosses
 *   DEFAULT_FIXTURE_DRIFT_RECAPTURE_THRESHOLD, so a slowly staling set is visible before it
 *   is worthless.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/mock_llm_provider.ts, packages/ai/src/constants.ts]
 */

import { assertEquals } from "@std/assert";
import { MockStrategy } from "@exaix/core";
import type { ICallSite } from "../../src/types.ts";
import { type IRecordedResponse, MockLLMProvider } from "../../src/providers/mock_llm_provider.ts";

function recording(callSite: ICallSite, promptHash: string): IRecordedResponse {
  return {
    promptHash,
    promptPreview: "p",
    response: "r",
    model: "claude-test-model",
    tokens: { input: 1, output: 1 },
    recordedAt: "2026-01-01T00:00:00Z",
    callSite,
  };
}

Deno.test("[drift_reporting] reportDrift totals drifted call sites against total call-site lookups", async () => {
  const siteA: ICallSite = { scenarioId: "flows", stepId: "a", callIndex: 0 };
  const siteB: ICallSite = { scenarioId: "flows", stepId: "b", callIndex: 0 };
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [recording(siteA, "stale-a"), recording(siteB, "stale-b")],
    patterns: [],
  });

  await provider.generate("changed prompt a", { callSite: siteA });
  await provider.generate("changed prompt b", { callSite: siteB });

  const summary = provider.reportDrift();
  assertEquals(summary.totalCallSiteLookups, 2);
  assertEquals(summary.driftedCalls, 2);
  assertEquals(summary.driftRate, 1);
  assertEquals(summary.overThreshold, true);
  assertEquals(summary.fixtures.length, 2);
});

Deno.test("[drift_reporting] an unchanged fixture set reports zero drift", async () => {
  const site: ICallSite = { scenarioId: "flows", stepId: "a", callIndex: 0 };
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings: [], patterns: [] });
  const prompt = "the exact recorded prompt";
  const promptHash = provider.hashPrompt(prompt);

  const stable = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [{ ...recording(site, promptHash), promptPreview: prompt }],
    patterns: [],
  });

  await stable.generate(prompt, { callSite: site });

  const summary = stable.reportDrift();
  assertEquals(summary.driftedCalls, 0);
  assertEquals(summary.driftRate, 0);
  assertEquals(summary.overThreshold, false);
});

Deno.test("[drift_reporting] a custom threshold overrides the configured default", async () => {
  const siteA: ICallSite = { scenarioId: "flows", stepId: "a", callIndex: 0 };
  const siteB: ICallSite = { scenarioId: "flows", stepId: "b", callIndex: 0 };

  // hashPrompt is a pure function of the prompt string; a throwaway instance computes the
  // same value the real provider will, so recording B's hash can be pre-matched.
  const hasher = new MockLLMProvider(MockStrategy.RECORDED, { recordings: [], patterns: [] });
  const promptB = "prompt b unchanged";
  const recordingB = { ...recording(siteB, hasher.hashPrompt(promptB)), promptPreview: promptB };

  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [recording(siteA, "stale-a"), recordingB],
    patterns: [],
  });

  await provider.generate("changed prompt a", { callSite: siteA });
  await provider.generate(promptB, { callSite: siteB });

  assertEquals(provider.reportDrift(0.6).overThreshold, false, "0.5 rate must stay under a 0.6 threshold");
  assertEquals(provider.reportDrift(0.4).overThreshold, true, "0.5 rate must exceed a 0.4 threshold");
});

Deno.test("[drift_reporting] calls with no callSite are excluded from the denominator (unaffected by unconfigured runs)", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [{
      promptHash: "abc",
      promptPreview: "You are a senior...",
      response: "ok",
      model: "claude-test-model",
      tokens: { input: 1, output: 1 },
      recordedAt: "2026-01-01T00:00:00Z",
    }],
    patterns: [],
  });

  await provider.generate("You are a senior...");

  const summary = provider.reportDrift();
  assertEquals(summary.totalCallSiteLookups, 0);
  assertEquals(summary.driftRate, 0);
});
