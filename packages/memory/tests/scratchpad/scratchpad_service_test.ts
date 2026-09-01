/**
 * @module ScratchpadServiceTest
 * @path packages/memory/tests/scratchpad/scratchpad_service_test.ts
 * @description Verifies the per-execution scratchpad store: append/read round-trip, concurrent
 * append safety on the JSONL file, per-trace isolation, and over-cap content rejection
 * (rejection, never silent truncation).
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";

import { ScratchpadService } from "@exaix/memory";
import { getMemoryExecutionDir, initTestDbService } from "@exaix/testing";
import { DEFAULT_SCRATCHPAD_MAX_ENTRY_BYTES } from "@exaix/core";

const SCRATCHPAD_FILENAME = "scratchpad.jsonl";

function scratchpadPath(tempDir: string, traceId: string): string {
  return join(getMemoryExecutionDir(tempDir), traceId, SCRATCHPAD_FILENAME);
}

Deno.test("ScratchpadService: append/read round-trip persists an entry to the execution scratchpad", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const service = new ScratchpadService(config);
    const appendResult = await service.append("trace-a", "worth remembering: X breaks under load", ["perf"]);
    assertEquals(appendResult.success, true);
    const entryId = (appendResult.data as { entry_id: string }).entry_id;
    assertExists(entryId);

    const entries = await service.read("trace-a");
    assertEquals(entries.length, 1);
    assertEquals(entries[0].id, entryId);
    assertEquals(entries[0].trace_id, "trace-a");
    assertEquals(entries[0].content, "worth remembering: X breaks under load");
    assertEquals(entries[0].tags, ["perf"]);
    assertExists(entries[0].created_at);
  } finally {
    await cleanup();
  }
});

Deno.test("ScratchpadService: concurrent appends within one execution do not corrupt the JSONL file", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const service = new ScratchpadService(config);
    const appends = Array.from({ length: 20 }, (_, i) => service.append("trace-concurrent", `note ${i}`));
    const results = await Promise.all(appends);
    assertEquals(results.filter((r) => r.success).length, 20);

    const raw = await Deno.readTextFile(scratchpadPath(config.system.root, "trace-concurrent"));
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    assertEquals(lines.length, 20, "every append must land as its own JSONL line");
    const parsed = lines.map((l) => JSON.parse(l) as { content: string });
    assertEquals(parsed.map((e) => e.content).sort(), Array.from({ length: 20 }, (_, i) => `note ${i}`).sort());

    const entries = await service.read("trace-concurrent");
    assertEquals(entries.length, 20);
  } finally {
    await cleanup();
  }
});

Deno.test("ScratchpadService: a scratchpad for one trace_id is invisible when reading another", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const service = new ScratchpadService(config);
    await service.append("trace-a", "private to trace-a");
    assertEquals(await service.read("trace-b"), []);
    assertEquals(await service.read("trace-a").then((e) => e.length), 1);
  } finally {
    await cleanup();
  }
});

Deno.test("ScratchpadService: over-cap content is rejected with a clear error, not truncated", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const service = new ScratchpadService(config);
    const oversized = "x".repeat(DEFAULT_SCRATCHPAD_MAX_ENTRY_BYTES + 1);
    const result = await service.append("trace-cap", oversized);
    assertEquals(result.success, false);
    assertExists(result.error);
    assertEquals(
      result.error?.includes(String(DEFAULT_SCRATCHPAD_MAX_ENTRY_BYTES)),
      true,
      "error must state the per-entry byte cap",
    );
    assertEquals(await service.read("trace-cap"), [], "rejected entries must not be written (no truncation)");
    assertEquals(await exists(scratchpadPath(config.system.root, "trace-cap")), false);
  } finally {
    await cleanup();
  }
});
