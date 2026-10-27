/**
 * @module ExecutionMemoryStoreHydrationTest
 * @path packages/core/tests/execution-memory/execution_memory_store_hydration_test.ts
 * @description The GAP-16 regression guard: a fresh ExecutionMemoryStore instance over a
 * trace_id with pre-existing on-disk entries (from a prior, now-discarded instance — the
 * FlowRunner.initCoreServices resume case) returns the correct prior values on the very
 * first readKeys/readNotes call, before any write happens in the new instance.
 */

import { assertEquals } from "@std/assert";

import { ExecutionMemoryStore } from "@exaix/core/execution-memory";
import { createMockConfig, withTempDir } from "@exaix/testing";

Deno.test("ExecutionMemoryStore: a fresh instance hydrates prior namespace state on first readKeys (GAP-16)", async () => {
  await withTempDir(async (tempDir) => {
    const traceId = crypto.randomUUID();
    const firstInstance = new ExecutionMemoryStore(createMockConfig(tempDir));
    await firstInstance.writeNamespaceEntries(
      traceId,
      "step-1",
      [{ key: "alpha", from: "summary", mode: "write" }],
      JSON.stringify({ summary: "prior-value" }),
    );
    await firstInstance.writeNamespaceEntries(traceId, "step-2", [{ key: "log", mode: "write" }], "prior-output");

    // Fresh instance, no writes in it — the resume-after-checkpoint shape.
    const resumedInstance = new ExecutionMemoryStore(createMockConfig(tempDir));
    const read = await resumedInstance.readKeys(traceId, ["alpha", "log"]);
    assertEquals(read.alpha, "prior-value");
    assertEquals(read.log, "prior-output");
  }, { prefix: "exa-exec-mem-hyd-" });
});

Deno.test("ExecutionMemoryStore: a fresh instance hydrates prior notes on first readNotes", async () => {
  await withTempDir(async (tempDir) => {
    const traceId = crypto.randomUUID();
    const firstInstance = new ExecutionMemoryStore(createMockConfig(tempDir));
    await firstInstance.appendNote(traceId, "jotted mid-run");

    const resumedInstance = new ExecutionMemoryStore(createMockConfig(tempDir));
    const notes = await resumedInstance.readNotes(traceId);
    assertEquals(notes.length, 1);
    assertEquals(notes[0].content, "jotted mid-run");
  }, { prefix: "exa-exec-mem-hyd-note-" });
});

Deno.test("ExecutionMemoryStore: hydrate-once stays correct across subsequent writes in the resumed instance", async () => {
  await withTempDir(async (tempDir) => {
    const traceId = crypto.randomUUID();
    const firstInstance = new ExecutionMemoryStore(createMockConfig(tempDir));
    await firstInstance.writeNamespaceEntries(traceId, "step-1", [{ key: "alpha", mode: "write" }], "prior-output");
    await firstInstance.appendNote(traceId, "prior note");

    const resumedInstance = new ExecutionMemoryStore(createMockConfig(tempDir));
    assertEquals((await resumedInstance.readKeys(traceId, ["alpha"])).alpha, "prior-output");

    await resumedInstance.appendNote(traceId, "resumed note");
    await resumedInstance.writeNamespaceEntries(traceId, "step-2", [{ key: "alpha", mode: "write" }], "resumed-output");

    const entries = await resumedInstance.readKeys(traceId, ["alpha"]);
    assertEquals(entries.alpha, "resumed-output");
    const notes = await resumedInstance.readNotes(traceId);
    assertEquals(notes.map((n) => n.content).sort(), ["prior note", "resumed note"]);
  }, { prefix: "exa-exec-mem-hyd-mix-" });
});
