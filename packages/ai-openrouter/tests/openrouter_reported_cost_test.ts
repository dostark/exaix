/**
 * @module OpenRouterReportedCostTest
 * @path packages/ai-openrouter/tests/openrouter_reported_cost_test.ts
 * @description Phase 135 Step 2 (F6/G9) — the dedicated OpenRouter token mapper reads
 *   the authoritative usage.cost from the response (requested via usage:{include:true})
 *   instead of the internal blended calculateCost estimate.
 * @architectural-layer AI-OpenRouter
 */
import { assertEquals } from "@std/assert";
import { tokenMapperOpenRouter } from "../src/openrouter_reported_cost.ts";

Deno.test("tokenMapperOpenRouter reads usage.cost as the reported cost", () => {
  const mapper = tokenMapperOpenRouter("openrouter/some-model");
  const mapped = mapper({
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300, cost: 0.0123 },
  });
  assertEquals(mapped?.cost_usd, 0.0123);
  assertEquals(mapped?.prompt_tokens, 100);
  assertEquals(mapped?.completion_tokens, 200);
  assertEquals(mapped?.total_tokens, 300);
});

Deno.test("tokenMapperOpenRouter without usage.cost leaves cost_usd undefined (no blended fallback)", () => {
  const mapper = tokenMapperOpenRouter("openrouter/some-model");
  const mapped = mapper({
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
  });
  assertEquals(mapped?.cost_usd, undefined);
});

Deno.test("tokenMapperOpenRouter returns undefined when usage is absent", () => {
  const mapper = tokenMapperOpenRouter("openrouter/some-model");
  assertEquals(mapper({}), undefined);
});

Deno.test("tokenMapperOpenRouter maps pass-through completion_tokens_details.reasoning_tokens into TokenMap.reasoning_tokens", () => {
  const mapper = tokenMapperOpenRouter("openrouter/o3-mini");
  const mapped = mapper({
    usage: {
      prompt_tokens: 100,
      completion_tokens: 2340,
      total_tokens: 2440,
      completion_tokens_details: { reasoning_tokens: 2000 },
    },
  });
  assertEquals(mapped?.reasoning_tokens, 2000);
  // Existing fields remain correct.
  assertEquals(mapped?.completion_tokens, 2340);
});

Deno.test("tokenMapperOpenRouter without a reasoning breakdown maps reasoning_tokens to undefined, not 0", () => {
  const mapper = tokenMapperOpenRouter("openrouter/some-model");
  const mapped = mapper({
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
  });
  assertEquals(mapped?.reasoning_tokens, undefined);
});
