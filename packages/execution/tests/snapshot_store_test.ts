/**
 * @module SnapshotStoreTest
 * @path packages/execution/tests/snapshot_store_test.ts
 * @description Tests for FileSnapshotStore: happy path, atomic write, and security invariants.
 * @architectural-layer Tests
 * @related-files ["packages/execution/src/context/snapshot_store.ts"]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import type { IContextBudgetSnapshot } from "@exaix/schemas";
import { FileSnapshotStore, SecurityError } from "@exaix/execution";

// Helpers

function makeSnapshot(traceId: string, stepId = "step-1"): IContextBudgetSnapshot {
  return {
    traceId,
    stepId,
    model: "anthropic:claude-sonnet-5",
    maxContextTokens: 200_000,
    usedInputTokens: 500,
    decisions: [],
    overflowRecovered: false,
    durationMs: 3,
  };
}

function makeResolver(tempDir: string): { resolve(path: string): Promise<string> } {
  return {
    resolve(path: string): Promise<string> {
      // Strip @Memory prefix, map to temp directory
      const stripped = path.replace(/^@Memory\//, "");
      return Promise.resolve(join(tempDir, stripped));
    },
  };
}

// Tests

Deno.test("[SnapshotStore] FileSnapshotStore: saves snapshot JSON to path rooted in @Memory/Execution/", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new FileSnapshotStore(makeResolver(tempDir));
    await store.save(makeSnapshot("trace-abc123"));

    const expectedPath = join(tempDir, "Execution", "trace-abc123", "step-1_snapshot.json");
    const raw = await Deno.readTextFile(expectedPath);
    const parsed = JSON.parse(raw);
    assertEquals(parsed.traceId, "trace-abc123");
    assertEquals(parsed.stepId, "step-1");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[SnapshotStore] FileSnapshotStore: rejects traceId containing path traversal (../../etc)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new FileSnapshotStore(makeResolver(tempDir));
    await assertRejects(
      () => store.save(makeSnapshot("../../etc")),
      SecurityError,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[SnapshotStore] FileSnapshotStore: rejects traceId with shell metacharacter ($, ;, |)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new FileSnapshotStore(makeResolver(tempDir));
    for (const badId of ["trace$1", "trace;1", "trace|1", "trace id", "trace/1"]) {
      await assertRejects(
        () => store.save(makeSnapshot(badId)),
        SecurityError,
      );
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[SnapshotStore] FileSnapshotStore: rejects stepId with path traversal characters", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new FileSnapshotStore(makeResolver(tempDir));
    for (const badStepId of ["../../etc", "step$1", "step;1", "step/1", "step|1", "step id"]) {
      await assertRejects(
        () => store.save(makeSnapshot("valid-trace", badStepId)),
        SecurityError,
      );
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[SnapshotStore] FileSnapshotStore: writes atomically (tmp file then rename)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const store = new FileSnapshotStore(makeResolver(tempDir));
    await store.save(makeSnapshot("trace-atomic", "step-1"));

    const finalPath = join(tempDir, "Execution", "trace-atomic", "step-1_snapshot.json");
    const tmpPath = `${finalPath}.tmp`;

    // Final file must exist with valid content
    const content = JSON.parse(await Deno.readTextFile(finalPath));
    assertEquals(content.traceId, "trace-atomic");

    // Tmp file must NOT exist after a successful atomic write
    let tmpExists = false;
    try {
      await Deno.stat(tmpPath);
      tmpExists = true;
    } catch {
      tmpExists = false;
    }
    assertEquals(tmpExists, false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
