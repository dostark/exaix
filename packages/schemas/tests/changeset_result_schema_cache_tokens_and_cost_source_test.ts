/**
 * @module ChangesetResultSchemaCacheTokensAndCostSourceTest
 * @path packages/schemas/tests/changeset_result_schema_cache_tokens_and_cost_source_test.ts
 * @description Phase 140a Step 2 — RED-first test. ChangesetResultSchema.usage is the
 * single shared trunk every execution strategy funnels its assembled usage through before
 * it reaches the journal; it currently declares only prompt_tokens/completion_tokens/
 * cost_usd. Widening only the leaf parsers (Anthropic, both CLI-delegate parsers, session
 * schema) without also widening this trunk would silently discard their cache-token data
 * at this exact chokepoint. Verifies the schema accepts and round-trips
 * cache_read_tokens/cache_creation_tokens and a new cost_source tag distinguishing a real
 * tracked figure from calculateCost()'s predicted one — defaulting to "predicted" so every
 * existing direct-API call site that doesn't set it explicitly keeps today's exact
 * behavior.
 * @architectural-layer Schemas
 * @related-files [packages/schemas/src/agent_orchestrator.ts]
 */

import { assertEquals } from "@std/assert";
import { ChangesetResultSchema } from "@exaix/schemas/agent_orchestrator.ts";

const BASE_RESULT = {
  branch: "feat/test",
  commit_sha: "abc1234",
  files_changed: ["src/foo.ts"],
  description: "test",
  tool_calls: 1,
  execution_time_ms: 100,
};

Deno.test("[ChangesetResultSchema] usage accepts and round-trips cache_read_tokens/cache_creation_tokens/cost_source", () => {
  const parsed = ChangesetResultSchema.parse({
    ...BASE_RESULT,
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      cost_usd: 0.05,
      cache_read_tokens: 20,
      cache_creation_tokens: 80,
      cost_source: "tracked",
    },
  });

  assertEquals(parsed.usage?.cache_read_tokens, 20);
  assertEquals(parsed.usage?.cache_creation_tokens, 80);
  assertEquals(parsed.usage?.cost_source, "tracked");
});

Deno.test("[ChangesetResultSchema] cost_source defaults to predicted when omitted (backward-compatible)", () => {
  const parsed = ChangesetResultSchema.parse({
    ...BASE_RESULT,
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      cost_usd: 0.05,
    },
  });

  assertEquals(parsed.usage?.cost_source, "predicted");
});

Deno.test("[ChangesetResultSchema] usage without cache fields still parses (fully additive)", () => {
  const parsed = ChangesetResultSchema.parse({
    ...BASE_RESULT,
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      cost_usd: 0.001,
    },
  });

  assertEquals(parsed.usage?.cache_read_tokens, undefined);
  assertEquals(parsed.usage?.cache_creation_tokens, undefined);
});

Deno.test("[ChangesetResultSchema] cost_source rejects an unknown value", () => {
  const result = ChangesetResultSchema.safeParse({
    ...BASE_RESULT,
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      cost_usd: 0.001,
      cost_source: "guessed",
    },
  });

  assertEquals(result.success, false);
});
