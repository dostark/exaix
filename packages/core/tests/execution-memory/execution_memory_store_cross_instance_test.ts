/**
 * @module ExecutionMemoryStoreCrossInstanceTest
 * @path packages/core/tests/execution-memory/execution_memory_store_cross_instance_test.ts
 * @description GAP-4 regression guard: two ExecutionMemoryStore instances over the same
 *   trace (the daemon-context store and FlowRunner's own) never lose updates — note
 *   appends survive a concurrent instance's namespace batch rewrite, and concurrent
 *   namespace batches from different instances union instead of clobbering.
 */

import { assertEquals } from "@std/assert";

import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
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

Deno.test("GAP-4: a note appended by instance B survives instance A's namespace batch rewrite", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-cross-inst-" });
  try {
    const config = makeConfig(tempDir);
    const traceId = crypto.randomUUID();
    const instanceA = new ExecutionMemoryStore(config);
    const instanceB = new ExecutionMemoryStore(config);

    // Interleaving that lost updates before the fix: A hydrates (empty), B appends,
    // then A rewrites the log for its namespace batch.
    await instanceA.readNotes(traceId);
    const appendResult = await instanceB.appendNote(traceId, "note appended by B after A hydrated");
    assertEquals(appendResult.success, true);

    await instanceA.writeNamespaceEntries(traceId, "step-1", [{ key: "k1", mode: "write" }], "v1");

    // A fresh instance reads from disk — the honest probe for what actually persisted.
    const diskReader = new ExecutionMemoryStore(config);
    const notes = await diskReader.readNotes(traceId);
    assertEquals(
      notes.some((n) => n.content === "note appended by B after A hydrated"),
      true,
      "instance A's namespace rewrite must not drop instance B's appended note",
    );
    assertEquals((await instanceA.readKeys(traceId, ["k1"])).k1, "v1");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("GAP-4: concurrent namespace batches from different instances union instead of clobbering", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-cross-conc-" });
  try {
    const config = makeConfig(tempDir);
    const traceId = crypto.randomUUID();
    const instanceA = new ExecutionMemoryStore(config);
    const instanceB = new ExecutionMemoryStore(config);

    const batches: Array<{ store: ExecutionMemoryStore; key: string }> = [];
    for (let i = 0; i < 3; i++) {
      batches.push({ store: instanceA, key: `a-key-${i}` });
      batches.push({ store: instanceB, key: `b-key-${i}` });
    }
    await Promise.all(
      batches.map(({ store, key }) =>
        store.writeNamespaceEntries(traceId, "step-x", [{ key, mode: "write" }], `value-${key}`)
      ),
    );

    const keys = batches.map(({ key }) => key);
    const entries = await instanceA.readKeys(traceId, keys);
    for (const key of keys) {
      assertEquals(entries[key], `value-${key}`, `concurrent batch key ${key} must survive`);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("GAP-4: notes appended between an instance's namespace batches are preserved across rewrites", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-cross-mix-" });
  try {
    const config = makeConfig(tempDir);
    const traceId = crypto.randomUUID();
    const instanceA = new ExecutionMemoryStore(config);
    const instanceB = new ExecutionMemoryStore(config);

    await instanceB.appendNote(traceId, "before");
    await instanceA.writeNamespaceEntries(traceId, "step-1", [{ key: "k", mode: "write" }], "v1");
    await instanceB.appendNote(traceId, "middle");
    await instanceA.writeNamespaceEntries(traceId, "step-2", [{ key: "k", mode: "append" }], "v2");

    const diskReader = new ExecutionMemoryStore(config);
    const notes = await diskReader.readNotes(traceId);
    assertEquals(notes.map((n) => n.content), ["before", "middle"]);
    assertEquals((await instanceA.readKeys(traceId, ["k"])).k, "v1\nv2");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
