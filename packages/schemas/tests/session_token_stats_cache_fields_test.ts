/**
 * @module SessionTokenStatsCacheFieldsTest
 * @path packages/schemas/tests/session_token_stats_cache_fields_test.ts
 * @description Phase 140a Step 2 — RED-first test. SessionTokenStatsSchema (the
 * session-delegate return.json contract, populated from either CLI parser's
 * IDelegateParsedReturn.tokenStats) has no cache fields, dropping prompt-cache data at this
 * final schema boundary even after both leaf parsers are widened. Verifies the schema
 * accepts and round-trips optional cache_read_tokens/cache_creation_tokens, defaulting to
 * undefined (not 0) when a tool doesn't report caching.
 * @architectural-layer Schemas
 * @related-files [packages/schemas/src/session_delegate.ts]
 */

import { assertEquals } from "@std/assert";
import { SessionTokenStatsSchema } from "@exaix/schemas/session_delegate.ts";

Deno.test("[SessionTokenStatsCacheFields] schema accepts and round-trips cache_read_tokens/cache_creation_tokens", () => {
  const parsed = SessionTokenStatsSchema.parse({
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    cache_read_tokens: 20,
    cache_creation_tokens: 80,
  });

  assertEquals(parsed.cache_read_tokens, 20);
  assertEquals(parsed.cache_creation_tokens, 80);
});

Deno.test("[SessionTokenStatsCacheFields] absent cache fields default to undefined, not 0", () => {
  const parsed = SessionTokenStatsSchema.parse({
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
  });

  assertEquals(parsed.cache_read_tokens, undefined);
  assertEquals(parsed.cache_creation_tokens, undefined);
});
