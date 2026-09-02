/**
 * @module ExecutionMemoryStoreNoteTest
 * @path packages/core/tests/execution-memory/execution_memory_store_note_test.ts
 * @description Port of the Step 9 note-capture contract onto the unified ExecutionMemoryStore:
 * appendNote/readNotes round-trip, concurrent append safety on the shared JSONL log,
 * per-trace isolation, and over-cap content rejection (rejection, never silent truncation).
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";

import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { resolveMemoryExecutionRoot } from "../../src/config/mod.ts";
import { DEFAULT_SCRATCHPAD_MAX_ENTRY_BYTES } from "@exaix/core";
import { ExecutionMemoryStore } from "@exaix/core/execution-memory";

const LOG_FILE_NAME = "scratchpad.jsonl";

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

function logPath(root: string, config: Config, traceId: string): string {
  return join(root, resolveMemoryExecutionRoot(config.paths), traceId, LOG_FILE_NAME);
}

Deno.test("ExecutionMemoryStore: appendNote/readNotes round-trip persists a note-kind entry", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-exec-mem-note-" });
  try {
    const config = makeConfig(tempDir);
    const store = new ExecutionMemoryStore(config);
    const appendResult = await store.appendNote("trace-a", "worth remembering: X breaks under load", ["perf"]);
    assertEquals(appendResult.success, true);
    const entryId = (appendResult.data as { entry_id: string }).entry_id;
    assertExists(entryId);

    const entries = await store.readNotes("trace-a");
    assertEquals(entries.length, 1);
    assertEquals(entries[0].id, entryId);
    assertEquals(entries[0].trace_id, "trace-a");
    assertEquals(entries[0].content, "worth remembering: X breaks under load");
    assertEquals(entries[0].tags, ["perf"]);
    assertEquals(entries[0].kind, "note");
    assertExists(entries[0].created_at);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionMemoryStore: concurrent appendNote calls do not corrupt the shared JSONL log", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-exec-mem-conc-" });
  try {
    const config = makeConfig(tempDir);
    const store = new ExecutionMemoryStore(config);
    const appends = Array.from({ length: 20 }, (_, i) => store.appendNote("trace-concurrent", `note ${i}`));
    const results = await Promise.all(appends);
    assertEquals(results.filter((r) => r.success).length, 20);

    const raw = await Deno.readTextFile(logPath(tempDir, config, "trace-concurrent"));
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    assertEquals(lines.length, 20, "every append must land as its own JSONL line");
    const parsed = lines.map((l) => JSON.parse(l) as { content: string; kind: string });
    assertEquals(parsed.every((e) => e.kind === "note"), true);
    assertEquals(parsed.map((e) => e.content).sort(), Array.from({ length: 20 }, (_, i) => `note ${i}`).sort());
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionMemoryStore: notes for one trace_id are invisible when reading another", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-exec-mem-iso-" });
  try {
    const store = new ExecutionMemoryStore(makeConfig(tempDir));
    await store.appendNote("trace-a", "private to trace-a");
    assertEquals(await store.readNotes("trace-b"), []);
    assertEquals((await store.readNotes("trace-a")).length, 1);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionMemoryStore: over-cap note content is rejected with a clear error, not truncated", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-exec-mem-cap-" });
  try {
    const config = makeConfig(tempDir);
    const store = new ExecutionMemoryStore(config);
    const oversized = "x".repeat(DEFAULT_SCRATCHPAD_MAX_ENTRY_BYTES + 1);
    const result = await store.appendNote("trace-cap", oversized);
    assertEquals(result.success, false);
    assertExists(result.error);
    assertEquals(
      result.error?.includes(String(DEFAULT_SCRATCHPAD_MAX_ENTRY_BYTES)),
      true,
      "error must state the per-entry byte cap",
    );
    assertEquals(await store.readNotes("trace-cap"), [], "rejected entries must not be written (no truncation)");
    assertEquals(await exists(logPath(tempDir, config, "trace-cap")), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
