/**
 * @module ProviderCostUnitTest
 * @path packages/ai/tests/provider_cost_unit_test.ts
 * @description Pins token-mapper monetary outputs to USD and preserves unknown compatible costs.
 * @architectural-layer AI
 * @dependencies [@exaix/ai, @exaix/ai-openrouter, @exaix/ai-openai, @std/assert]
 * @related-files [packages/ai/src/provider_common_utils.ts, packages/ai/src/openai_responses_wire.ts, packages/ai-openrouter/src/openrouter_reported_cost.ts, packages/ai-openai/src/compatible_chat.ts]
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import { tokenMapperResponses } from "@exaix/ai/openai_responses_wire.ts";
import { tokenMapperAnthropic, tokenMapperGoogle } from "@exaix/ai/provider_common_utils.ts";
import { tokenMapperOpenRouter } from "@exaix/ai-openrouter";
import { mapCompatibleUsage } from "@exaix/ai-openai/src/compatible_chat.ts";

Deno.test("OpenAI Responses token mapper returns USD at the configured per-1K rate", () => {
  const map = tokenMapperResponses("gpt-fixture");
  const response = { usage: { input_tokens: 600, output_tokens: 400 } };
  assertAlmostEquals(map(response, "openai-gpt-fixture")!.cost_usd!, 0.002);
  assertEquals(map(response)?.cost_usd, undefined);
  assertEquals(map({}, "openai-gpt-fixture"), undefined);
});

Deno.test("Anthropic token mapper returns USD at the configured per-1K rate", () => {
  const map = tokenMapperAnthropic("claude-fixture");
  const response = { usage: { input_tokens: 1200, output_tokens: 800 } };
  assertAlmostEquals(map(response, "anthropic-claude-fixture")!.cost_usd!, 0.01);
  assertEquals(map(response)?.cost_usd, undefined);
  assertEquals(map({}, "anthropic-claude-fixture"), undefined);
});

Deno.test("Google token mapper returns USD with input and output rates and bills thoughts once", () => {
  const map = tokenMapperGoogle("gemini-fixture");
  const response = {
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300 },
  };
  const mapped = map(response, "google-gemini-fixture");
  assertAlmostEquals(mapped!.cost_usd!, 0.002625);
  assertEquals(mapped?.reasoning_tokens, 300);
  assertEquals(map(response)?.cost_usd, undefined);
  assertEquals(map({}, "google-gemini-fixture"), undefined);
});

Deno.test("OpenRouter token mapper preserves the reported USD amount and never guesses an absent cost", () => {
  const map = tokenMapperOpenRouter("vendor/model");
  const usage = { prompt_tokens: 600, completion_tokens: 400, total_tokens: 1000 };
  for (const amount of [0, 0.0123]) {
    assertEquals(map({ usage: { ...usage, cost: amount } })?.cost_usd, amount);
  }
  assertEquals(map({ usage })?.cost_usd, undefined);
  assertEquals(map({}), undefined);
});

Deno.test("compatible token mapper keeps cost unknown instead of assuming USD from usage or token counts", () => {
  const response = {
    model: "compatible/model",
    usage: { prompt_tokens: 600, completion_tokens: 400, total_tokens: 1000, cost: 0.0123 },
  };
  const mapped = mapCompatibleUsage(response);
  assertEquals(mapped.cost_usd, undefined);
  assertEquals(mapped.total_tokens, 1000);
  assertEquals(mapped.model, "compatible/model");
});
