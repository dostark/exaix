/**
 * @module AnthropicCacheTokensTest
 * @path packages/ai/tests/anthropic_cache_tokens_test.ts
 * @description Phase 140a Step 2 — RED-first test. Anthropic's real Messages API response
 * includes cache_creation_input_tokens/cache_read_input_tokens when prompt caching is active
 * (anthropic_provider.ts sends cache_control on prompt blocks), but AnthropicUsage only
 * declares input_tokens/output_tokens — the real cache-token fields are dropped at parse
 * time, so Exaix cannot verify or measure its own prompt-cache savings. Verifies
 * tokenMapperAnthropic maps the real fields into TokenMap's new cache_read_tokens/
 * cache_creation_tokens, and that a response with no cache fields (no cache_control sent,
 * or a provider that doesn't support caching) produces undefined, not 0 — a step whose
 * response never touched the cache is "unknown", not "zero cache usage".
 * @architectural-layer AI
 * @related-files [packages/ai/src/provider_common_utils.ts]
 */

import { assertEquals } from "@std/assert";
import { tokenMapperAnthropic, tokenMapperGoogle, tokenMapperOpenAI } from "@exaix/ai/provider_common_utils.ts";

const TEST_MODEL = "claude-sonnet-5";
const TEST_PROVIDER_ID = "anthropic";

Deno.test("[AnthropicCacheTokens] tokenMapperAnthropic maps real cache_creation_input_tokens/cache_read_input_tokens into TokenMap", () => {
  const mapper = tokenMapperAnthropic(TEST_MODEL);
  const mockResponse = {
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 200,
    },
  };

  const result = mapper(mockResponse, TEST_PROVIDER_ID);

  assertEquals(result?.cache_read_tokens, 200);
  assertEquals(result?.cache_creation_tokens, 1000);
  // Existing fields remain correct alongside the new ones.
  assertEquals(result?.prompt_tokens, 100);
  assertEquals(result?.completion_tokens, 50);
});

Deno.test("[AnthropicCacheTokens] a response with no cache fields maps to undefined, not 0", () => {
  const mapper = tokenMapperAnthropic(TEST_MODEL);
  const mockResponse = {
    usage: {
      input_tokens: 100,
      output_tokens: 50,
    },
  };

  const result = mapper(mockResponse, TEST_PROVIDER_ID);

  assertEquals(result?.cache_read_tokens, undefined);
  assertEquals(result?.cache_creation_tokens, undefined);
});

Deno.test("[AnthropicCacheTokens] OpenAI/Google TokenMap results accept cache fields on the type but leave them undefined (no real API field parsed yet)", () => {
  const openAiResult = tokenMapperOpenAI("gpt-4")({
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }, "openai");
  const googleResult = tokenMapperGoogle("gemini-pro")({
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  }, "google");

  assertEquals(openAiResult?.cache_read_tokens, undefined);
  assertEquals(openAiResult?.cache_creation_tokens, undefined);
  assertEquals(googleResult?.cache_read_tokens, undefined);
  assertEquals(googleResult?.cache_creation_tokens, undefined);
});
