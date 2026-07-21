/**
 * @module CostMappingCacheTokensTest
 * @path packages/session/tests/cost_mapping_cache_tokens_test.ts
 * @description Phase 140a Step 2 — RED-first test. sessionReturnToCostRecord maps
 * SessionReturn.token_stats into IProviderCostRecord, but neither type carries
 * cache_read_tokens/cache_creation_tokens — dropping cache-token data at this
 * cost-tracking-specific boundary even after SessionTokenStatsSchema is widened. Verifies
 * cacheReadTokens/cacheCreationTokens are carried through, and that estimatedCostUsd
 * continues to source from the real sessionReturn.cost_usd figure, not a computed
 * estimate (the session-delegate cost-tracking path must remain at parity with the rest
 * of this phase's fidelity).
 * @architectural-layer Services
 * @related-files [packages/session/src/cost_mapping.ts, packages/core/src/types/database.ts]
 */

import { assertEquals } from "@std/assert";
import { sessionReturnToCostRecord } from "@exaix/session/cost_mapping.ts";
import type { SessionReturn } from "@exaix/schemas/session_delegate.ts";

function makeSessionReturn(overrides: Partial<SessionReturn> = {}): SessionReturn {
  return {
    trace_id: "00000000-0000-0000-0000-000000000001",
    resume_token: "tok-1",
    decision: "changes_made",
    summary: "Applied the fix",
    paths_touched: [],
    token_stats: {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      cache_read_tokens: 20,
      cache_creation_tokens: 80,
    },
    cost_usd: 0.05,
    ...overrides,
  };
}

Deno.test("[cost_mapping] sessionReturnToCostRecord carries cache tokens from token_stats into IProviderCostRecord", () => {
  const record = sessionReturnToCostRecord({
    id: "rec-1",
    tool: "opencode",
    sessionReturn: makeSessionReturn(),
    timestamp: new Date("2026-07-21T00:00:00.000Z"),
  });

  assertEquals(record.cacheReadTokens, 20);
  assertEquals(record.cacheCreationTokens, 80);
  // estimatedCostUsd continues to source from the real sessionReturn.cost_usd — never computed.
  assertEquals(record.estimatedCostUsd, 0.05);
});

Deno.test("[cost_mapping] token_stats with no cache fields produces undefined cacheReadTokens/cacheCreationTokens, not 0", () => {
  const record = sessionReturnToCostRecord({
    id: "rec-2",
    tool: "claude-code",
    sessionReturn: makeSessionReturn({
      token_stats: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    }),
    timestamp: new Date("2026-07-21T00:00:00.000Z"),
  });

  assertEquals(record.cacheReadTokens, undefined);
  assertEquals(record.cacheCreationTokens, undefined);
});
