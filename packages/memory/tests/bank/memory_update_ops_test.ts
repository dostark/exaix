/**
 * @module MemoryUpdateOpsTest
 * @path packages/memory/tests/bank/memory_update_ops_test.ts
 * @description Verifies auditable update, soft-delete, and supersede learning transitions.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import { MemoryStatus } from "@exaix/core/status";
import { createSampleLearning } from "@exaix/testing";
import { createTestMemoryBankWithGlobal } from "../helpers/memory_bank_harness.ts";

Deno.test("MemoryBankService: update and soft-delete retain audit records but exclude retrieval", async () => {
  const learning = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Original durable guidance",
    status: MemoryStatus.APPROVED,
  });
  const { service, cleanup } = await createTestMemoryBankWithGlobal();
  try {
    await service.addGlobalLearning(learning);
    await service.updateLearning(learning.id, { title: "Revised durable guidance", tags: ["revised"] });
    await service.deleteLearning(learning.id);

    const stored = (await service.getGlobalMemory())!.learnings.find((item) => item.id === learning.id)!;
    assertEquals(stored.title, "Revised durable guidance");
    assertEquals(stored.tags, ["revised"]);
    assertEquals(stored.status, MemoryStatus.DELETED);
    assertEquals((await service.searchByKeyword("durable")).some((item) => item.id === learning.id), false);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: supersede retains old record and links it to approved replacement", async () => {
  const oldLearning = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Use callbacks",
    status: MemoryStatus.APPROVED,
  });
  const newLearning = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Prefer async-await",
    description: "Use async-await for sequential asynchronous control flow.",
    status: MemoryStatus.APPROVED,
  });
  const { service, cleanup } = await createTestMemoryBankWithGlobal();
  try {
    await service.addGlobalLearning(oldLearning);
    await service.supersedeLearning(oldLearning.id, newLearning);

    const learnings = (await service.getGlobalMemory())!.learnings;
    const oldStored = learnings.find((item) => item.id === oldLearning.id)!;
    const newStored = learnings.find((item) => item.id === newLearning.id)!;
    assertEquals(oldStored.status, MemoryStatus.SUPERSEDED);
    assertEquals(oldStored.superseded_by, newLearning.id);
    assertEquals(newStored.supersedes, oldLearning.id);
    assertEquals((await service.searchByKeyword("callbacks")).length, 0);
    assertEquals((await service.searchByKeyword("async-await"))[0].id, newLearning.id);
  } finally {
    await cleanup();
  }
});
