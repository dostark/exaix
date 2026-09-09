/**
 * @module Phase176ContextRecordStoreTest
 * @path packages/session/tests/phase176_context_record_store_test.ts
 * @description Phase 176 Step 1: ContextRecordStore persists immutable capture records
 * atomically under @Memory/Execution/<trace>/context/, refuses duplicate ids, partial
 * writes never leave a readable final file, symlink components are refused, and
 * retention/reading is bounded to valid UUID trace/record ids.
 * @architectural-layer Tests
 * @related-files [packages/session/src/context_record_store.ts]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ContextRecordAlreadyExistsError, ContextRecordSecurityError, ContextRecordStore } from "@exaix/session";
import { CONTEXT_RECORD_SCHEMA_VERSION, type ContextRecord } from "@exaix/schemas/dogfood_context.ts";

const TRACE_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "22222222-2222-4222-8222-222222222222";
const PARENT_TRACE_ID = "33333333-3333-4333-8333-333333333333";

function makeRecord(overrides: Partial<ContextRecord> = {}): ContextRecord {
  return {
    schemaVersion: CONTEXT_RECORD_SCHEMA_VERSION,
    recordId: RECORD_ID,
    executionTraceId: TRACE_ID,
    parentTraceId: PARENT_TRACE_ID,
    stepId: "step-1",
    sequence: 1,
    turn: 0,
    attempt: 1,
    surface: "session_delegate_cycle",
    model: "anthropic:claude-sonnet-5",
    timestamp: new Date().toISOString(),
    originalInputSha256: "a".repeat(64),
    promptText: "the exact post-redaction submission",
    promptSha256: "b".repeat(64),
    originalTokenCount: 100,
    finalTokenCount: 80,
    tokenSource: "counted",
    effectiveInputLimit: 16384,
    effectiveReserveLimit: 4096,
    sections: [],
    tools: [],
    visibility: "exaix_submission_only",
    nativePrompt: "unknown",
    nativeTools: "unknown",
    nativeHistory: "unknown",
    ...overrides,
  };
}

function makeResolver(tempDir: string): { resolve(path: string): Promise<string> } {
  return {
    resolve(path: string): Promise<string> {
      const stripped = path === "@Memory" ? "" : path.replace(/^@Memory\//, "");
      return Promise.resolve(join(tempDir, stripped));
    },
  };
}

Deno.test("[ContextRecordStore] save then read round-trips the exact record", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    const record = makeRecord();
    await store.save(record);

    const read = await store.read(TRACE_ID, RECORD_ID);
    assertEquals(read, record);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] save writes under @Memory/Execution/<trace>/context/<recordId>.json", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    await store.save(makeRecord());

    const expectedPath = join(tempDir, "Execution", TRACE_ID, "context", `${RECORD_ID}.json`);
    const raw = await Deno.readTextFile(expectedPath);
    assertEquals(JSON.parse(raw).recordId, RECORD_ID);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] save is atomic: no leftover temp file after success", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    await store.save(makeRecord());

    const contextDir = join(tempDir, "Execution", TRACE_ID, "context");
    const entries = await Array.fromAsync(Deno.readDir(contextDir));
    assertEquals(entries.length, 1, "only the final record file must remain, no .tmp artifact");
    assertEquals(entries[0].name, `${RECORD_ID}.json`);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] rejects saving a record with a duplicate id — never overwrites", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    await store.save(makeRecord());

    await assertRejects(
      () => store.save(makeRecord({ promptText: "a different, later submission" })),
      ContextRecordAlreadyExistsError,
    );

    // The original content must be unchanged.
    const read = await store.read(TRACE_ID, RECORD_ID);
    assertEquals(read.promptText, "the exact post-redaction submission");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] rejects an invalid executionTraceId (not a UUID) before touching the filesystem", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    await assertRejects(
      () => store.save(makeRecord({ executionTraceId: "../../etc/passwd" })),
      ContextRecordSecurityError,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] rejects an invalid stepId with path-traversal characters", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    await assertRejects(
      () => store.save(makeRecord({ stepId: "../../etc" })),
      ContextRecordSecurityError,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] refuses to write when a context directory ancestor is a symlink", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const realExecutionDir = join(tempDir, "RealExecution");
    await Deno.mkdir(realExecutionDir, { recursive: true });
    const executionLink = join(tempDir, "Execution");
    await Deno.symlink(realExecutionDir, executionLink, { type: "dir" });

    const store = new ContextRecordStore(makeResolver(tempDir));
    await assertRejects(
      () => store.save(makeRecord()),
      ContextRecordSecurityError,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] read throws for a record that was never captured", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    await assertRejects(() => store.read(TRACE_ID, RECORD_ID));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] list returns an empty array for a trace with no captures", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    assertEquals(await store.list(TRACE_ID), []);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] list orders records by sequence, then turn, then attempt", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    const second = makeRecord({
      recordId: "44444444-4444-4444-8444-444444444444",
      sequence: 2,
      turn: 0,
      attempt: 1,
    });
    const first = makeRecord({
      recordId: "55555555-5555-4555-8555-555555555555",
      sequence: 1,
      turn: 0,
      attempt: 1,
    });
    await store.save(second);
    await store.save(first);

    const summaries = await store.list(TRACE_ID);
    assertEquals(summaries.map((s) => s.recordId), [first.recordId, second.recordId]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] pruneExpired removes only records older than the retention window", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    const now = new Date("2026-06-15T00:00:00.000Z");
    const oldRecord = makeRecord({
      recordId: "66666666-6666-4666-8666-666666666666",
      timestamp: "2026-06-01T00:00:00.000Z", // 14 days before `now`
    });
    const recentRecord = makeRecord({
      recordId: "77777777-7777-4777-8777-777777777777",
      timestamp: "2026-06-14T00:00:00.000Z", // 1 day before `now`
    });
    await store.save(oldRecord);
    await store.save(recentRecord);

    const prunedCount = await store.pruneExpired(7, now);

    assertEquals(prunedCount, 1);
    await assertRejects(() => store.read(TRACE_ID, oldRecord.recordId));
    const stillThere = await store.read(TRACE_ID, recentRecord.recordId);
    assertEquals(stillThere.recordId, recentRecord.recordId);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] pruneExpired returns 0 when the execution root does not exist", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    assertEquals(await store.pruneExpired(7, new Date()), 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] listByParentTrace returns an empty array when nothing matches", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    assertEquals(await store.listByParentTrace(PARENT_TRACE_ID), []);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] listByParentTrace finds records across multiple child execution traces, bounded to the Execution root", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    const childA = "88888888-8888-4888-8888-888888888888";
    const childB = "99999999-9999-4999-8999-999999999999";
    const recordInChildA = makeRecord({
      recordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      executionTraceId: childA,
      parentTraceId: PARENT_TRACE_ID,
      sequence: 2,
    });
    const recordInChildB = makeRecord({
      recordId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      executionTraceId: childB,
      parentTraceId: PARENT_TRACE_ID,
      sequence: 1,
    });
    await store.save(recordInChildA);
    await store.save(recordInChildB);

    const summaries = await store.listByParentTrace(PARENT_TRACE_ID);
    // Ordered sequence/turn/attempt/timestamp/recordId — same ordering contract as list().
    assertEquals(summaries.map((s) => s.recordId), [recordInChildB.recordId, recordInChildA.recordId]);
    assertEquals(summaries.every((s) => s.parentTraceId === PARENT_TRACE_ID), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] listByParentTrace never returns a record belonging to an unrelated parent trace", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    const otherParent = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const unrelated = makeRecord({
      recordId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      executionTraceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      parentTraceId: otherParent,
    });
    await store.save(unrelated);

    assertEquals(await store.listByParentTrace(PARENT_TRACE_ID), []);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] listByParentTrace never resurrects a pruned record — no reconstruction after expiry", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    const now = new Date("2026-06-15T00:00:00.000Z");
    await store.save(makeRecord({ timestamp: "2026-06-01T00:00:00.000Z" })); // 14 days before `now`

    assertEquals((await store.listByParentTrace(PARENT_TRACE_ID)).length, 1);
    await store.pruneExpired(7, now);
    assertEquals(await store.listByParentTrace(PARENT_TRACE_ID), []);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[ContextRecordStore] created files/directories are owner-only permissioned (POSIX)", async () => {
  if (Deno.build.os === "windows") return;
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new ContextRecordStore(makeResolver(tempDir));
    await store.save(makeRecord());

    const contextDir = join(tempDir, "Execution", TRACE_ID, "context");
    const dirStat = await Deno.stat(contextDir);
    const fileStat = await Deno.stat(join(contextDir, `${RECORD_ID}.json`));
    assert(dirStat.mode !== null && (dirStat.mode & 0o777) === 0o700, "directory must be 0700");
    assert(fileStat.mode !== null && (fileStat.mode & 0o777) === 0o600, "file must be 0600");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
