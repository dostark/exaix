/**
 * @module OpenRouterReportedCostTest
 * @path packages/ai-openrouter/tests/openrouter_reported_cost_test.ts
 * @description Phase 135 Step 2 (F6/G9) — the dedicated OpenRouter token mapper reads
 *   the authoritative usage.cost from the response (requested via usage:{include:true})
 *   instead of the internal blended calculateCost estimate.
 * @architectural-layer AI-OpenRouter
 */
import { assertEquals } from "@std/assert";
import { reportedCostCredits, tokenMapperOpenRouter } from "../src/openrouter_reported_cost.ts";

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

const MAPPER = tokenMapperOpenRouter("vendor/configured-model");

Deno.test("cached_tokens maps to cache_read_tokens and cache_write_tokens maps to cache_creation_tokens", () => {
  const mapped = MAPPER({
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 150 },
    },
  });
  assertEquals(mapped?.cache_read_tokens, 800);
  assertEquals(mapped?.cache_creation_tokens, 150);
});

Deno.test("absent cache fields stay undefined, and a reported zero stays zero", () => {
  const absent = MAPPER({ usage: { prompt_tokens: 10, completion_tokens: 5 } });
  assertEquals([absent?.cache_read_tokens, absent?.cache_creation_tokens], [undefined, undefined]);
  const zero = MAPPER({
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    },
  });
  assertEquals([zero?.cache_read_tokens, zero?.cache_creation_tokens], [0, 0]);
});

Deno.test("the response model id is the TokenMap model, and an absent one keeps the configured id", () => {
  assertEquals(
    MAPPER({ model: "qwen/qwen3.7-flash-20260727", usage: { prompt_tokens: 1, completion_tokens: 1 } })?.model,
    "qwen/qwen3.7-flash-20260727",
  );
  assertEquals(MAPPER({ usage: { prompt_tokens: 1, completion_tokens: 1 } })?.model, "vendor/configured-model");
});

Deno.test("cost_details.upstream_inference_cost and cache_discount map to TokenMap, and absent ones stay undefined", () => {
  const mapped = MAPPER({
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      cost: 0.0002,
      cost_details: { upstream_inference_cost: 0.00021 },
      cache_discount: 0.00003,
    },
  });
  assertEquals(mapped?.upstream_inference_cost, 0.00021);
  assertEquals(mapped?.cache_discount, 0.00003);
  const absent = MAPPER({ usage: { prompt_tokens: 10, completion_tokens: 5 } });
  assertEquals([absent?.upstream_inference_cost, absent?.cache_discount], [undefined, undefined]);
});

Deno.test("a usage object recorded from the live API maps every field", () => {
  const mapped = MAPPER({
    model: "qwen/qwen3.7-flash",
    usage: {
      prompt_tokens: 15,
      completion_tokens: 1,
      total_tokens: 16,
      cost: 6.6033e-07,
      is_byok: false,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, audio_tokens: 0, video_tokens: 0 },
      cost_details: {
        upstream_inference_cost: 6.67e-07,
        upstream_inference_prompt_cost: 5.175e-07,
        upstream_inference_completions_cost: 1.495e-07,
      },
      completion_tokens_details: { reasoning_tokens: 0, image_tokens: 0, audio_tokens: 0 },
    },
  });
  assertEquals(mapped, {
    prompt_tokens: 15,
    completion_tokens: 1,
    total_tokens: 16,
    model: "qwen/qwen3.7-flash",
    cost_usd: 6.6033e-07,
    reasoning_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    upstream_inference_cost: 6.67e-07,
    cache_discount: undefined,
  });
});

Deno.test("reportedCostCredits reads usage.cost as OpenRouter credits, and is undefined when the field is absent", () => {
  assertEquals(reportedCostCredits({ prompt_tokens: 1, completion_tokens: 1, cost: 0.0123 }), 0.0123);
  assertEquals(reportedCostCredits({ prompt_tokens: 1, completion_tokens: 1 }), undefined);
});
