/**
 * @module SupersedeEventTest
 * @path packages/memory/tests/bank/supersede_event_test.ts
 * @description GAP-7 event-reconciliation: `supersedeLearning` journals
 *   `MemoryLearningSuperseded` exactly once with canonical payload fields (learning_id,
 *   superseded_by, reason) through a real EventLogger.
 */

import { assertEquals } from "@std/assert";

import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { MemoryStatus } from "@exaix/core/status";
import { MemoryBankService } from "@exaix/memory";
import { createSampleLearning, initTestDbService } from "@exaix/testing";

Deno.test("supersedeLearning journals MemoryLearningSuperseded with canonical payload through a real EventLogger", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const bank = new MemoryBankService(config, logger);
    await bank.initGlobalMemory();

    const oldLearning = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Old guidance",
      description: "Outdated guidance.",
      status: MemoryStatus.APPROVED,
    });
    const newLearning = createSampleLearning({
      id: crypto.randomUUID(),
      title: "New guidance",
      description: "Corrected guidance.",
      status: MemoryStatus.APPROVED,
    });
    await bank.addGlobalLearning(oldLearning);

    await bank.supersedeLearning(oldLearning.id, newLearning, "contradicted by newer evidence");
    await db.waitForFlush();

    const rows = db.getActivitiesByActionType(DomainEventType.MemoryLearningSuperseded);
    assertEquals(rows.length, 1, "exactly one supersession event must be journalled");
    const payload = JSON.parse(rows[0].payload) as {
      learning_id: string;
      superseded_by: string;
      reason: string;
    };
    assertEquals(payload.learning_id, oldLearning.id);
    assertEquals(payload.superseded_by, newLearning.id);
    assertEquals(payload.reason, "contradicted by newer evidence");
  } finally {
    await cleanup();
  }
});
