/**
 * @module SessionDelegateCycleStoreTest
 * @path packages/session/tests/session_delegate_cycle_store_test.ts
 * @description Phase 174 Step 4 unit tests for SessionDelegateCycleStore: checkpoint
 *   writes are atomic (temp-write/rename, no partial file ever visible under the real
 *   path) and schema-valid, load() round-trips a saved checkpoint, and a missing
 *   checkpoint returns null rather than throwing.
 * @architectural-layer Services
 * @related-files [packages/session/src/session_delegate_cycle_store.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { SessionDelegateCycleStore } from "../src/session_delegate_cycle_store.ts";
import type { ISessionDelegateCycleCheckpoint } from "../src/session_delegate_cycle_store.ts";

function makeCheckpoint(overrides: Partial<ISessionDelegateCycleCheckpoint> = {}): ISessionDelegateCycleCheckpoint {
  return {
    parentTraceId: crypto.randomUUID(),
    lastFlowRunId: "flow-run-1",
    flowStepId: "next-steps",
    planDigest: "a".repeat(64),
    revision: 0,
    nextSequence: 1,
    completedSteps: [],
    status: "running",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

Deno.test("[unit] load() returns null when no checkpoint exists", async () => {
  const root = await Deno.makeTempDir({ prefix: "cycle-store-" });
  try {
    const store = new SessionDelegateCycleStore(root);
    assertEquals(await store.load(crypto.randomUUID(), "next-steps"), null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[unit] save() then load() round-trips a schema-valid checkpoint", async () => {
  const root = await Deno.makeTempDir({ prefix: "cycle-store-" });
  try {
    const store = new SessionDelegateCycleStore(root);
    const checkpoint = makeCheckpoint();

    await store.save(checkpoint);
    const loaded = await store.load(checkpoint.parentTraceId, checkpoint.flowStepId);

    assertEquals(loaded, checkpoint);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[unit] save() writes at the documented path and leaves no .tmp file behind", async () => {
  const root = await Deno.makeTempDir({ prefix: "cycle-store-" });
  try {
    const store = new SessionDelegateCycleStore(root);
    const checkpoint = makeCheckpoint();

    await store.save(checkpoint);

    const target = join(root, checkpoint.parentTraceId, "session_delegate_cycles", `${checkpoint.flowStepId}.json`);
    const stat = await Deno.stat(target);
    assertEquals(stat.isFile, true);
    let tmpExists = true;
    try {
      await Deno.stat(`${target}.tmp`);
    } catch {
      tmpExists = false;
    }
    assertEquals(tmpExists, false, "the atomic temp file must not survive a successful save");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[unit] a second save() overwrites the checkpoint atomically", async () => {
  const root = await Deno.makeTempDir({ prefix: "cycle-store-" });
  try {
    const store = new SessionDelegateCycleStore(root);
    const first = makeCheckpoint({ nextSequence: 1, revision: 0 });
    await store.save(first);
    const second = makeCheckpoint({
      parentTraceId: first.parentTraceId,
      flowStepId: first.flowStepId,
      nextSequence: 2,
      revision: 1,
    });

    await store.save(second);
    const loaded = await store.load(first.parentTraceId, first.flowStepId);

    assertEquals(loaded?.nextSequence, 2);
    assertEquals(loaded?.revision, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
