/**
 * @module FlowNamespacePersistenceTest
 * @path packages/flow/tests/flow_namespace_persistence_test.ts
 * @related-files []
 * @architectural-layer Flow
 * @description TODO: Add description
 */

import { assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import type { IFlowNamespaceWrite } from "@exaix/schemas/flow.ts";
import { FlowNamespaceService } from "@exaix/flow";
import { getMemoryExecutionDir, initTestDbService } from "@exaix/testing";

Deno.test("FlowNamespaceService persists, reads, appends, and deletes trace-scoped namespace state", async () => {
  const { config, tempDir, cleanup } = await initTestDbService();

  try {
    const service = new FlowNamespaceService(config);
    const traceId = "trace-flow-namespace-001";
    const namespacePath = join(getMemoryExecutionDir(tempDir), traceId, "namespace.md");

    assertEquals(service.getNamespacePath(traceId), namespacePath);

    const emptySnapshot = await service.load(traceId);
    assertEquals(emptySnapshot.traceId, traceId);
    assertEquals(emptySnapshot.path, namespacePath);
    assertEquals(emptySnapshot.entries, {});
    assertEquals(await exists(namespacePath), false);

    const summaryWrites: IFlowNamespaceWrite[] = [{ key: "review.summary", mode: "write" }];
    const notesWrites: IFlowNamespaceWrite[] = [{ key: "review.notes", mode: "append" }];

    await service.writeEntries(traceId, "review", summaryWrites, "Looks good");
    await service.writeEntries(traceId, "review", notesWrites, "First note");
    await service.writeEntries(traceId, "review", notesWrites, "Second note");

    assertEquals(await exists(namespacePath), true);

    const readKeys = await service.readKeys(traceId, ["review.summary", "review.notes", "missing.key"]);
    assertEquals(readKeys["review.summary"], "Looks good");
    assertEquals(readKeys["review.notes"], "First note\nSecond note");
    assertEquals(readKeys["missing.key"], undefined);

    const loadedSnapshot = await service.load(traceId);
    assertEquals(loadedSnapshot.entries["review.summary"], "Looks good");
    assertEquals(loadedSnapshot.entries["review.notes"], "First note\nSecond note");

    await service.delete(traceId);
    assertEquals(await exists(namespacePath), false);
  } finally {
    await cleanup();
  }
});
