/**
 * @module ExecutionMemoryStoreTraceIdTest
 * @path packages/core/tests/execution-memory/execution_memory_store_trace_id_test.ts
 * @description [security] GAP-2 regression guard: every ExecutionMemoryStore method
 *   fail-closes on a traversal-shaped or malformed trace id with a clear error and
 *   performs zero file I/O outside the store root; a valid id passes unchanged.
 */

import { assertEquals, assertExists, assertRejects, assertThrows } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";

import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { resolveMemoryExecutionRoot } from "../../src/config/mod.ts";
import { ExecutionMemoryStore } from "@exaix/core/execution-memory";

function makeConfig(root: string): Config {
  return ConfigSchema.parse({
    system: { root },
    paths: {},
    database: {},
    watcher: {},
    agents: {},
    models: {},
    portals: [],
    mcp: {},
  });
}

const MALFORMED_IDS = ["../x", "a/b", "/abs/path", "..", ".", "trace id with spaces", "a\tb", ""];

Deno.test("[security] every store method fail-closes on a traversal-shaped trace id with zero file I/O", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-trace-id-sec-" });
  try {
    const config = makeConfig(tempDir);
    const store = new ExecutionMemoryStore(config);

    for (const bad of MALFORMED_IDS) {
      assertThrows(
        () => store.getNamespacePath(bad),
        Error,
        "Invalid execution trace id",
        `getNamespacePath must reject ${JSON.stringify(bad)}`,
      );
      await assertRejects(
        () => store.appendNote(bad, "note"),
        Error,
        "Invalid execution trace id",
        `appendNote must reject ${JSON.stringify(bad)}`,
      );
      await assertRejects(
        () => store.readNotes(bad),
        Error,
        "Invalid execution trace id",
        `readNotes must reject ${JSON.stringify(bad)}`,
      );
      await assertRejects(
        () => store.readKeys(bad, ["k"]),
        Error,
        "Invalid execution trace id",
        `readKeys must reject ${JSON.stringify(bad)}`,
      );
      await assertRejects(
        () => store.writeNamespaceEntries(bad, "step-1", [{ key: "k", mode: "write" }], "v"),
        Error,
        "Invalid execution trace id",
        `writeNamespaceEntries must reject ${JSON.stringify(bad)}`,
      );
    }

    // Zero file I/O: nothing under the execution root beyond the pre-existing dir.
    const executionRoot = join(tempDir, resolveMemoryExecutionRoot(config.paths));
    const entries: string[] = [];
    try {
      for await (const entry of Deno.readDir(executionRoot)) entries.push(entry.name);
    } catch {
      // root not created yet — also fine (no I/O happened)
    }
    assertEquals(entries.length, 0, "a rejected trace id must not create any directory or file");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[security] a valid trace id passes validation unchanged", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-trace-id-valid-" });
  try {
    const config = makeConfig(tempDir);
    const store = new ExecutionMemoryStore(config);
    const traceId = crypto.randomUUID();

    const result = await store.appendNote(traceId, "valid note");
    assertEquals(result.success, true);
    assertEquals((await store.readNotes(traceId)).length, 1);

    await store.writeNamespaceEntries(traceId, "step-1", [{ key: "k", mode: "write" }], "v");
    assertEquals((await store.readKeys(traceId, ["k"])).k, "v");

    assertExists(store.getNamespacePath(traceId));
    assertEquals(await exists(join(store.getNamespacePath(traceId))), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
