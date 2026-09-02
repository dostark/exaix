/**
 * @module ExecutionMemoryStoreSharedLogTest
 * @path packages/core/tests/execution-memory/execution_memory_store_shared_log_test.ts
 * @description A note entry and a namespace entry written to the same trace_id coexist in one
 * JSONL log file; readNotes never returns namespace-kind entries and readKeys never returns
 * note-kind entries — the kind discriminator genuinely isolates the two views over shared
 * storage.
 */

import { assertEquals } from "@std/assert";
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

Deno.test("ExecutionMemoryStore: note and namespace entries coexist in one log, isolated by the kind discriminator", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-exec-mem-shared-" });
  try {
    const config = makeConfig(tempDir);
    const store = new ExecutionMemoryStore(config);
    const traceId = crypto.randomUUID();

    await store.appendNote(traceId, "a free-form agent note");
    await store.writeNamespaceEntries(
      traceId,
      "step-1",
      [{ key: "result", from: "summary", mode: "write" }],
      JSON.stringify({ summary: "structured step output" }),
    );

    const notes = await store.readNotes(traceId);
    assertEquals(notes.length, 1, "readNotes must return only note-kind entries");
    assertEquals(notes[0].content, "a free-form agent note");

    const entries = await store.readKeys(traceId, ["result"]);
    assertEquals(entries.result, "structured step output", "readKeys must return only namespace-kind entries");

    const raw = await Deno.readTextFile(
      join(tempDir, resolveMemoryExecutionRoot(config.paths), traceId, "scratchpad.jsonl"),
    );
    const kinds = raw.split("\n").filter((l) => l.trim().length > 0).map((l) =>
      (JSON.parse(l) as { kind: string }).kind
    );
    assertEquals(kinds.sort(), ["namespace", "note"], "both kinds share the one log file");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionMemoryStore: a namespace write that rewrites the log preserves existing notes", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-exec-mem-rewrite-" });
  try {
    const store = new ExecutionMemoryStore(makeConfig(tempDir));
    const traceId = crypto.randomUUID();

    await store.appendNote(traceId, "note before rewrite");
    await store.writeNamespaceEntries(traceId, "step-1", [{ key: "k1", mode: "write" }], "v1");
    await store.appendNote(traceId, "note between writes");
    await store.writeNamespaceEntries(traceId, "step-2", [{ key: "k1", mode: "write" }], "v2");
    await store.writeNamespaceEntries(traceId, "step-3", [{ key: "k2", mode: "write" }], "v3");

    const entries = await store.readKeys(traceId, ["k1", "k2"]);
    assertEquals(entries.k1, "v2", "write mode replaces the previous namespace value");
    assertEquals(entries.k2, "v3");
    const notes = await store.readNotes(traceId);
    assertEquals(notes.map((n) => n.content).sort(), ["note before rewrite", "note between writes"]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
