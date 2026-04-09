/**
 * @module FlowNamespacePersistenceTest
 * @path tests/integration/services/flow_namespace_persistence_test.ts
 * @description Integration coverage for FlowNamespaceService persistence lifecycle and trace-scoped storage.
 * @architectural-layer Test
 * @related-files [src/services/flow/flow_namespace_service.ts, src/services/flow/flow_checkpoint_service.ts]
 */

import { assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import type { IFlowNamespaceWrite } from "../../../src/shared/schemas/flow.ts";
import { FlowNamespaceService } from "../../../src/services/flow/flow_namespace_service.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { getMemoryExecutionDir } from "../../helpers/paths_helper.ts";

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
