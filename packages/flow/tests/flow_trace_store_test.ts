/**
 * @module FlowTraceStoreTest
 * @path packages/flow/tests/flow_trace_store_test.ts
 * @description Unit tests for the durable per-request parent trace store (Phase 174 Step 2).
 * @architectural-layer Flows
 * @related-files [packages/flow/src/flow_trace_store.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FlowTraceStore, isUuid } from "../src/flow_trace_store.ts";

Deno.test("[unit] isUuid accepts a well-formed UUID and rejects garbage", () => {
  assertEquals(isUuid("00000000-0000-4000-8000-000000000173"), true);
  assertEquals(isUuid("not-a-uuid"), false);
  assertEquals(isUuid(""), false);
});

Deno.test("[restart] getOrCreate mints a UUID and reuses it for the same requestId", async () => {
  const dir = await Deno.makeTempDir({ prefix: "flow-trace-store-" });
  try {
    const store = new FlowTraceStore(dir);
    const first = await store.getOrCreate("req-1");
    assertEquals(isUuid(first), true);
    const second = await store.getOrCreate("req-1");
    assertEquals(second, first, "the same requestId must resolve to the same trace across calls");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[restart] getOrCreate reuses the trace after a fresh store instance (simulated restart)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "flow-trace-store-restart-" });
  try {
    const first = await new FlowTraceStore(dir).getOrCreate("req-restart");
    const second = await new FlowTraceStore(dir).getOrCreate("req-restart");
    assertEquals(second, first);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[unit] different requestIds mint distinct traces", async () => {
  const dir = await Deno.makeTempDir({ prefix: "flow-trace-store-distinct-" });
  try {
    const store = new FlowTraceStore(dir);
    const a = await store.getOrCreate("req-a");
    const b = await store.getOrCreate("req-b");
    assertEquals(a === b, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[unit] the trace record is persisted to <rootDir>/<requestId>.json", async () => {
  const dir = await Deno.makeTempDir({ prefix: "flow-trace-store-file-" });
  try {
    const store = new FlowTraceStore(dir);
    const traceId = await store.getOrCreate("req-file");
    const raw = await Deno.readTextFile(join(dir, "req-file.json"));
    const record = JSON.parse(raw);
    assertEquals(record.traceId, traceId);
    assertEquals(record.requestId, "req-file");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
