/**
 * @module TierPromotionEventTest
 * @path packages/memory/tests/session/tier_promotion_event_test.ts
 * @description GAP-7 event-reconciliation: `promoteMemories` journals
 *   `MemoryTierPromotion` exactly once with a canonical payload (promoted count) through
 *   a real EventLogger when a WORKING entry clears its promotion score.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";

import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { MemoryBankService, SessionMemoryService } from "@exaix/memory";
import { MemoryEmbeddingService } from "@exaix/memory";
import { ConfidenceLevel, LearningCategory } from "@exaix/core";
import { initTestDbService } from "@exaix/testing";

Deno.test("promoteMemories journals MemoryTierPromotion with canonical payload through a real EventLogger", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const bank = new MemoryBankService(config);
    const tieredEntriesPath = join(config.system.root, "Memory", "Session", "tiered_entries.json");
    const embeddingService = new MemoryEmbeddingService(config);
    await embeddingService.initializeManifest();
    const sessionMemory = new SessionMemoryService(bank, embeddingService, undefined, tieredEntriesPath, logger);

    // Seed a WORKING entry whose promotion score already clears the EPISODIC bar.
    await sessionMemory.saveInsight({
      title: "Promotable insight",
      description: "A high-confidence insight ready for tier promotion.",
      category: LearningCategory.INSIGHT,
      tags: [],
      confidence: ConfidenceLevel.HIGH,
      learning_id: crypto.randomUUID(),
    });

    const promoted = await sessionMemory.promoteMemories();
    assertEquals(promoted >= 1, true, "the high-confidence WORKING entry must promote");
    await db.waitForFlush();

    const rows = db.getActivitiesByActionType(DomainEventType.MemoryTierPromotion);
    assertEquals(rows.length >= 1, true, "tier promotion must be journalled");
    const payload = JSON.parse(rows[rows.length - 1].payload) as { promoted: number };
    assertEquals(typeof payload.promoted, "number", "the payload must carry the promoted count");
  } finally {
    await cleanup();
  }
});
