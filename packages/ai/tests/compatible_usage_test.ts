/**
 * @module CompatibleUsageTest
 * @path packages/ai/tests/compatible_usage_test.ts
 * @description Verifies compatible usage preserves unknown cost rather than applying OpenAI list pricing.
 * @architectural-layer Tests
 * @dependencies [@exaix/ai]
 * @related-files [packages/ai/src/provider_common_utils.ts, packages/execution/src/strategies/react_loop_strategy.ts]
 */
import { assertEquals } from "@std/assert";
import { tokenMapperOpenAI } from "../src/provider_common_utils.ts";
import { priceCompatibleUsage } from "../src/compatible_usage.ts";
import type { IModelPricing } from "@exaix/core/types";

Deno.test("openai-chat usage does not inherit first-party OpenAI price estimates", () => {
  const mapped = tokenMapperOpenAI("fixture-model")({
    usage: { prompt_tokens: 12, completion_tokens: 5 },
  }, "openai-chat-fixture-model");
  assertEquals(mapped?.prompt_tokens, 12);
  assertEquals(mapped?.cost_usd, undefined);
});

const FIXTURE_PRICING: IModelPricing = {
  provider: "openai",
  model: "returned-fixture",
  inputPerMtok: 2,
  outputPerMtok: 8,
  cacheReadPerMtok: 1,
  provenance: "static",
  verifiedAt: 1,
  sourceUrl: "https://fixture.invalid/rates/revision-1",
};

Deno.test("compatible pricing uses exact returned-model verified rates and subtracts cached input once", () => {
  const price = priceCompatibleUsage("openai", "returned-fixture", {
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    cacheReadTokens: 40,
    reasoningTokens: 10,
  }, FIXTURE_PRICING);
  assertEquals(price.costStatus, "estimated");
  assertEquals(price.cost_usd, (60 * 2 + 40 * 1 + 20 * 8) / 1_000_000);
});

Deno.test("compatible pricing stays unknown for local fixtures, aliases and missing verified cache rates", () => {
  const usage = { promptTokens: 100, completionTokens: 20, totalTokens: 120, cacheReadTokens: 40 };
  for (
    const [profile, model, pricing] of [
      ["local-test", "returned-fixture", FIXTURE_PRICING],
      ["deepseek", "returned-fixture", FIXTURE_PRICING],
      ["openai", "requested-alias", FIXTURE_PRICING],
      ["openai", "returned-fixture", { ...FIXTURE_PRICING, cacheReadPerMtok: undefined }],
      ["openai", "returned-fixture", { ...FIXTURE_PRICING, verifiedAt: undefined }],
    ] as const
  ) {
    assertEquals(priceCompatibleUsage(profile, model, usage, pricing), { costStatus: "unknown" });
  }
});
