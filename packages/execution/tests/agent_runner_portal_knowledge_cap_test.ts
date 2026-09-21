/**
 * @module AgentRunnerPortalKnowledgeCapTest
 * @path packages/execution/tests/agent_runner_portal_knowledge_cap_test.ts
 * @description Phase 196 follow-up — Fix A: a hard, configurable token cap on the
 *   `portal_knowledge` segment at the prompt-assembly boundary, independent of any budget
 *   ceiling. Closes the bypass where `request.context.portal_knowledge` is set directly
 *   (agent/eval/CLI-supplied) and would otherwise enter the prompt at unbounded size, even
 *   when no `ContextBudgetManager` pressure exists. Truncation keeps whole lines (never a
 *   mid-line cut) and uses the real tokenizer for the estimate when available.
 * @architectural-layer Test
 * @related-files [packages/execution/src/agent_runner.ts, packages/core/src/types/constants.ts, packages/schemas/src/config.ts]
 */

import { assert, assertEquals, assertLessOrEqual } from "@std/assert";
import { AgentRunner } from "@exaix/execution";
import type { IBlueprint, IParsedRequest } from "@exaix/execution";
import { MockProvider } from "@exaix/ai/providers.ts";
import { AiTokenEstimatorTokenizer, type ITokenizer } from "@exaix/core/func";
import { PORTAL_KNOWLEDGE_KEY } from "@exaix/core";

const WELL_FORMED_RESPONSE = "<thought>ok</thought><content>done</content>";

const mockAgentBlueprint: IBlueprint = { systemPrompt: "You are a test agent." };

/** Char-counting tokenizer stub (each char = 1 token) — makes the cap's line-boundary
 *  truncation deterministic and independently assertable. */
function makeCharCountingTokenizer(): ITokenizer {
  return {
    countTokens: (text: string) => Promise.resolve(text.length),
    countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((t) => t.length)),
  };
}

function makeRequest(overrides: Partial<IParsedRequest> = {}): IParsedRequest {
  return { userPrompt: "Do the thing.", context: {}, ...overrides };
}

function makeRunner(capTokens: number, tokenizer?: ITokenizer): AgentRunner {
  return new AgentRunner(new MockProvider(WELL_FORMED_RESPONSE), {
    tokenizer,
    context: {
      config: {
        get: () => ({ portal_knowledge: { max_tokens: capTokens } }),
      },
    } as never,
  });
}

Deno.test("[AgentRunner] portal_knowledge assembled content is capped at the configured max_tokens, truncating at a whole-line boundary", async () => {
  const runner = makeRunner(30, makeCharCountingTokenizer());
  // 5 whole lines of 7 chars each — under a 30-token cap only the first 4 whole lines fit.
  const portal = Array.from({ length: 5 }, () => "aaaaaa\n").join("");
  const preview = await runner.previewPrompt(
    mockAgentBlueprint,
    makeRequest({
      context: { [PORTAL_KNOWLEDGE_KEY]: portal },
    }),
  );

  const seg = preview.segments.find((s) => s.kind === "portal_knowledge");
  assert(seg, "a portal_knowledge segment must be present in the preview");
  assertLessOrEqual(seg.tokenEstimate, 30);
  // Truncation must stop at a whole-line boundary: 4 of the 6-char lines fit under the
  // 30-token cap (the 5th line's candidate would push the keepto 34>30); the kept join is
  // 4*6 chars + 3 newlines = 27 tokens.
  assertEquals(seg.tokenEstimate, 27);
  assertEquals(preview.totalTokenEstimate, preview.segments.reduce((sum, s) => sum + s.tokenEstimate, 0));
});

Deno.test("[AgentRunner] portal_knowledge under the cap is untouched (no regression)", async () => {
  const runner = makeRunner(30, makeCharCountingTokenizer());
  const portal = "aaaaaa\n"; // 7 chars / tokens, well under 30
  const preview = await runner.previewPrompt(
    mockAgentBlueprint,
    makeRequest({
      context: { [PORTAL_KNOWLEDGE_KEY]: portal },
    }),
  );

  const seg = preview.segments.find((s) => s.kind === "portal_knowledge");
  assert(seg);
  assertEquals(seg.tokenEstimate, 7);
});

Deno.test("[AgentRunner] portal_knowledge cap uses the real tokenizer estimate when a tokenizer is wired", async () => {
  const runner = makeRunner(250, new AiTokenEstimatorTokenizer());
  const portal = "*".repeat(4000); // ~1000+ real tokens — far over a 250-token cap
  const preview = await runner.previewPrompt(
    mockAgentBlueprint,
    makeRequest({
      context: { [PORTAL_KNOWLEDGE_KEY]: portal },
    }),
  );

  const seg = preview.segments.find((s) => s.kind === "portal_knowledge");
  assert(seg);
  assertLessOrEqual(seg.tokenEstimate, 250, `capped portal_knowledge must not exceed the 250-token cap`);
});
