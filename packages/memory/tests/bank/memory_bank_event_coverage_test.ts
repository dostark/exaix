/**
 * @module MemoryBankEventCoverageTest
 * @path packages/memory/tests/bank/memory_bank_event_coverage_test.ts
 * @description Verifies update, delete, and supersede mutations are journal-visible.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import { MemoryStatus } from "@exaix/core/status";
import { createSampleLearning } from "@exaix/testing";
import { createTestMemoryBankWithGlobal } from "../helpers/memory_bank_harness.ts";

Deno.test("MemoryBankService: learning mutation events include required metadata", async () => {
  const original = createSampleLearning({ id: crypto.randomUUID(), status: MemoryStatus.APPROVED });
  const replacement = createSampleLearning({ id: crypto.randomUUID(), status: MemoryStatus.APPROVED });
  const deleted = createSampleLearning({ id: crypto.randomUUID(), status: MemoryStatus.APPROVED });
  const { service, db, cleanup } = await createTestMemoryBankWithGlobal();
  try {
    await service.addGlobalLearning(original);
    await service.addGlobalLearning(deleted);
    await service.updateLearning(original.id, { title: "Updated title" });
    await service.deleteLearning(deleted.id);
    await service.supersedeLearning(original.id, replacement);
    await db.waitForFlush();

    const rows = db.instance.prepare(
      "SELECT action_type, payload FROM activity WHERE action_type IN (?, ?, ?) ORDER BY action_type",
    ).all("memory.learning.deleted", "memory.learning.superseded", "memory.learning.updated") as Array<{
      action_type: string;
      payload: string;
    }>;
    assertEquals(rows.map((row) => row.action_type), [
      "memory.learning.deleted",
      "memory.learning.superseded",
      "memory.learning.updated",
    ]);
    const payloads = Object.fromEntries(rows.map((row) => [row.action_type, JSON.parse(row.payload)]));
    assertEquals(payloads["memory.learning.updated"].learning_id, original.id);
    assertEquals(payloads["memory.learning.updated"].updated_fields, ["title"]);
    assertEquals(payloads["memory.learning.deleted"].learning_id, deleted.id);
    assertEquals(typeof payloads["memory.learning.deleted"].reason, "string");
    assertEquals(payloads["memory.learning.superseded"].learning_id, original.id);
    assertEquals(payloads["memory.learning.superseded"].superseded_by, replacement.id);
  } finally {
    await cleanup();
  }
});
