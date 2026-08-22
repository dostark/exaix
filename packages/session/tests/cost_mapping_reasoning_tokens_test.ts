/**
 * @module CostMappingReasoningTokensTest
 * @path packages/session/tests/cost_mapping_reasoning_tokens_test.ts
 * @description Phase 167 Step 12 — RED-first test. sessionReturnToCostRecord maps
 * SessionReturn.token_stats into IProviderCostRecord, but neither type carries
 * reasoning_tokens — dropping reasoning-token data at this cost-tracking-specific boundary
 * even after SessionTokenStatsSchema is widened. Verifies reasoningTokens is carried through,
 * mirroring cost_mapping_cache_tokens_test.ts's Phase 140a pattern for the same class of bug.
 * @architectural-layer Services
 * @related-files [packages/session/src/cost_mapping.ts, packages/core/src/types/database.ts]
 */

import { assertEquals } from "@std/assert";
import { sessionReturnToCostRecord } from "@exaix/session/cost_mapping.ts";
import type { SessionReturn } from "@exaix/schemas/session_delegate.ts";

function makeSessionReturn(overrides: Partial<SessionReturn> = {}): SessionReturn {
  return {
    trace_id: "00000000-0000-0000-0000-000000000002",
    resume_token: "tok-1",
    decision: "changes_made",
    summary: "Applied the fix",
    paths_touched: [],
    token_stats: {
      input_tokens: 150,
      output_tokens: 2340,
      total_tokens: 2490,
      reasoning_tokens: 2048,
    },
    cost_usd: 0.05,
    ...overrides,
  };
}

Deno.test("[cost_mapping] sessionReturnToCostRecord carries reasoning tokens from token_stats into IProviderCostRecord", () => {
  const record = sessionReturnToCostRecord({
    id: "rec-3",
    tool: "codex",
    sessionReturn: makeSessionReturn(),
    timestamp: new Date("2026-08-22T00:00:00.000Z"),
  });

  assertEquals(record.reasoningTokens, 2048);
  // estimatedCostUsd continues to source from the real sessionReturn.cost_usd — never computed.
  assertEquals(record.estimatedCostUsd, 0.05);
});

Deno.test("[cost_mapping] token_stats with no reasoning_tokens produces undefined reasoningTokens, not 0", () => {
  const record = sessionReturnToCostRecord({
    id: "rec-4",
    tool: "codex",
    sessionReturn: makeSessionReturn({
      token_stats: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    }),
    timestamp: new Date("2026-08-22T00:00:00.000Z"),
  });

  assertEquals(record.reasoningTokens, undefined);
});
