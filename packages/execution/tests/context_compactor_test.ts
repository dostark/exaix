/**
 * @module ContextCompactorTest
 * @path packages/execution/tests/context_compactor_test.ts
 * @description Tests for LlmContextCompactor and NoopContextCompactor.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/execution/src/context/context_compactor.ts",
 *   "packages/execution/src/context/context_segment.ts"
 * ]
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import type { IModelOptions, IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { CONTEXT_PRIORITY_TOOL_RESULT } from "@exaix/core";
import type { IContextSegment } from "@exaix/execution";
import { LlmContextCompactor, NoopContextCompactor } from "@exaix/execution";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeToolResultSegment(): IContextSegment {
  return {
    segmentId: crypto.randomUUID(),
    kind: "tool_result",
    content: "Large tool output with many details that should be summarized.",
    priority: CONTEXT_PRIORITY_TOOL_RESULT,
    tokenEstimate: 50,
    metadata: {},
  };
}

const MOCK_USAGE = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

function makeProvider(response: string): IModelProvider {
  return {
    generate(_prompt: string, _opts?: IModelOptions): Promise<IGenerateResult> {
      return Promise.resolve({
        content: response,
        model: "mock",
        provider: "mock",
        usage: MOCK_USAGE,
      });
    },
  } as IModelProvider;
}

function makeFailingProvider(): IModelProvider {
  return {
    generate(_prompt: string, _opts?: IModelOptions): Promise<IGenerateResult> {
      return Promise.reject(new Error("provider unavailable"));
    },
  } as IModelProvider;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("[ContextCompactor] LlmContextCompactor: summarize() calls provider.generate() with a non-empty prompt", async () => {
  let capturedPrompt = "";
  const trackingProvider: IModelProvider = {
    generate(prompt: string, _opts?: IModelOptions): Promise<IGenerateResult> {
      capturedPrompt = prompt;
      return Promise.resolve({
        content: "Summarized.",
        model: "mock",
        provider: "mock",
        usage: MOCK_USAGE,
      });
    },
  } as IModelProvider;

  const compactor = new LlmContextCompactor();
  await compactor.summarize(makeToolResultSegment(), trackingProvider);

  assertNotEquals(capturedPrompt, "");
  assertEquals(capturedPrompt.length > 0, true);
});

Deno.test("[ContextCompactor] LlmContextCompactor: returned segment has kind 'summary'", async () => {
  const compactor = new LlmContextCompactor();
  const result = await compactor.summarize(
    makeToolResultSegment(),
    makeProvider("Summarized content."),
  );
  assertEquals(result.kind, "summary");
});

Deno.test("[ContextCompactor] LlmContextCompactor: returns original segment with same tokenEstimate when provider throws", async () => {
  const compactor = new LlmContextCompactor();
  const segment = makeToolResultSegment();
  const result = await compactor.summarize(segment, makeFailingProvider());

  assertEquals(result.segmentId, segment.segmentId);
  assertEquals(result.tokenEstimate, segment.tokenEstimate);
  assertEquals(result.kind, segment.kind);
});

Deno.test("[ContextCompactor] NoopContextCompactor: returns segment reference-equal to input", async () => {
  const compactor = new NoopContextCompactor();
  const segment = makeToolResultSegment();
  const result = await compactor.summarize(segment, makeProvider("ignored"));
  assertEquals(result, segment);
});

Deno.test("[ContextCompactor] LlmContextCompactor: summary call requests enough output tokens for thinking models", async () => {
  let capturedMaxTokens: number | undefined;
  const trackingProvider: IModelProvider = {
    generate(_prompt: string, opts?: IModelOptions): Promise<IGenerateResult> {
      capturedMaxTokens = opts?.max_tokens;
      return Promise.resolve({
        content: "Summarized.",
        model: "mock",
        provider: "mock",
        usage: MOCK_USAGE,
      });
    },
  } as IModelProvider;

  const compactor = new LlmContextCompactor();
  await compactor.summarize(makeToolResultSegment(), trackingProvider);

  // On models whose thinking blocks count against max_tokens, a 200-token cap can be
  // consumed entirely by thinking, yielding an empty summary. 2048 leaves room for
  // thinking plus the short summary the prompt asks for.
  assertEquals(capturedMaxTokens, 2048);
});
