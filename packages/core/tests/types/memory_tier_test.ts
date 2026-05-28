/**
 * @module MemoryTierTest
 * @path packages/core/tests/types/memory_tier_test.ts
 * @description Tests for MemoryTier enum, ITieredMemoryEntry, and tier constants.
 * @architectural-layer Core
 * @related-files [packages/core/src/types/enums.ts, packages/core/src/types/memory.ts, packages/core/src/types/constants.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { MemoryTier } from "@exaix/core";
import type { ITieredMemoryEntry } from "@exaix/core/types";
import { MEMORY_TIER_EPISODIC_PROMOTION_THRESHOLD, MEMORY_TIER_SEMANTIC_PROMOTION_ACCESS_COUNT } from "@exaix/core";

Deno.test("[MemoryTier] enum has expected values", () => {
  assertEquals(MemoryTier.WORKING, "working");
  assertEquals(MemoryTier.EPISODIC, "episodic");
  assertEquals(MemoryTier.SEMANTIC, "semantic");
});

Deno.test("[MemoryTier] ITieredMemoryEntry can be constructed", () => {
  const entry: ITieredMemoryEntry = {
    id: "test-id",
    content: "Test learning content",
    tier: MemoryTier.WORKING,
    source: { planId: "plan-1", stepId: "step-1" },
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    accessCount: 1,
    promotionScore: 0,
  };
  assertExists(entry);
  assertEquals(entry.tier, MemoryTier.WORKING);
});

Deno.test("[MemoryTier] tier promotion constants are defined", () => {
  assertEquals(typeof MEMORY_TIER_EPISODIC_PROMOTION_THRESHOLD, "number");
  assertExists(MEMORY_TIER_EPISODIC_PROMOTION_THRESHOLD);
  assertEquals(typeof MEMORY_TIER_SEMANTIC_PROMOTION_ACCESS_COUNT, "number");
  assertExists(MEMORY_TIER_SEMANTIC_PROMOTION_ACCESS_COUNT);
});
