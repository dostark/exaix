/**
 * @module ExecutionMemoryStoreEventTest
 * @path packages/memory/tests/scratchpad/execution_memory_store_event_test.ts
 * @description Verifies that a successful ExecutionMemoryStore.appendNote emits MemoryScratchpadEntryAdded
 * through a real EventLogger with trace_id/entry_id/content_length metadata and no raw content.
 */

import { assertEquals } from "@std/assert";

import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { ExecutionMemoryStore } from "@exaix/core/execution-memory";
import { initTestDbService } from "@exaix/testing";

/** Expected metadata payload of a MemoryScratchpadEntryAdded journal row. */
interface ScratchpadEventPayload {
  trace_id: string;
  entry_id: string;
  content_length: number;
}

Deno.test("ExecutionMemoryStore: a successful appendNote emits MemoryScratchpadEntryAdded without raw content", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const service = new ExecutionMemoryStore(config, new EventLogger({ db }));
    const result = await service.appendNote("trace-event", "sensitive agent-authored note");
    assertEquals(result.success, true);
    const entryId = (result.data as { entry_id: string }).entry_id;

    await db.waitForFlush();
    const rows = db.getActivitiesByActionType(DomainEventType.MemoryScratchpadEntryAdded);
    assertEquals(rows.length, 1, "every successful append must emit exactly one event");

    const payload: ScratchpadEventPayload = JSON.parse(rows[0].payload);
    assertEquals(payload.trace_id, "trace-event");
    assertEquals(payload.entry_id, entryId);
    assertEquals(payload.content_length, "sensitive agent-authored note".length);
    assertEquals(
      "content" in payload,
      false,
      "raw agent-authored content must not be duplicated into the activity journal",
    );
  } finally {
    await cleanup();
  }
});
