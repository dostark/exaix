/**
 * @module FlowNamespaceServiceContractTest
 * @path packages/flow/tests/flow_namespace_service_contract_test.ts
 * @related-files []
 * @architectural-layer Flow
 * @description TODO: Add description
 */

import { assertEquals, assertRejects } from "@std/assert";
import type { IFlowNamespaceWrite } from "@exaix/schemas/flow.ts";
import type { IFlowNamespaceService, IFlowNamespaceSnapshot } from "@exaix/flow";
import { FlowNamespaceService, NamespaceQuotaExceededError } from "@exaix/flow";
import { createMockConfig } from "@exaix/testing";

class StubFlowNamespaceService implements IFlowNamespaceService {
  getNamespacePath(traceId: string): string {
    return `/tmp/${traceId}/namespace.md`;
  }

  initialize(traceId: string): Promise<IFlowNamespaceSnapshot> {
    return Promise.resolve(this.createSnapshot(traceId));
  }

  load(traceId: string): Promise<IFlowNamespaceSnapshot> {
    return Promise.resolve(this.createSnapshot(traceId));
  }

  readKeys(traceId: string, keys: string[]): Promise<Record<string, string | undefined>> {
    const snapshot = this.createSnapshot(traceId);
    const result = Object.fromEntries(keys.map((key) => [key, snapshot.entries[key]]));
    return Promise.resolve(result);
  }

  writeEntries(
    traceId: string,
    stepId: string,
    writes: IFlowNamespaceWrite[],
    stepOutput: string,
  ): Promise<IFlowNamespaceSnapshot> {
    const entries = Object.fromEntries(
      writes.map((write) => [write.key, write.from ? `${stepOutput}:${write.from}` : stepOutput]),
    );

    return Promise.resolve({
      traceId,
      path: this.getNamespacePath(traceId),
      entries,
      updatedAt: `${stepId}-updated`,
    });
  }

  delete(_traceId: string): Promise<void> {
    return Promise.resolve();
  }

  snapshot(traceId: string): Promise<IFlowNamespaceSnapshot> {
    return Promise.resolve(this.createSnapshot(traceId));
  }

  restore(_traceId: string, _snapshot: IFlowNamespaceSnapshot): Promise<void> {
    return Promise.resolve();
  }

  private createSnapshot(traceId: string): IFlowNamespaceSnapshot {
    return {
      traceId,
      path: this.getNamespacePath(traceId),
      entries: {},
      updatedAt: "2026-04-08T12:00:00.000Z",
    };
  }
}

const validSnapshot: IFlowNamespaceSnapshot = {
  traceId: "trace-123",
  path: "/tmp/trace-123/namespace.md",
  entries: {
    "review.summary": "Complete",
  },
  updatedAt: "2026-04-08T12:00:00.000Z",
};

Deno.test("[IFlowNamespaceService] stub satisfies interface contract", () => {
  const service: IFlowNamespaceService = new StubFlowNamespaceService();

  assertEquals(typeof service.getNamespacePath, "function");
  assertEquals(typeof service.initialize, "function");
  assertEquals(typeof service.load, "function");
  assertEquals(typeof service.readKeys, "function");
  assertEquals(typeof service.writeEntries, "function");
  assertEquals(typeof service.delete, "function");
  assertEquals(typeof service.snapshot, "function");
  assertEquals(typeof service.restore, "function");
});

Deno.test("[IFlowNamespaceSnapshot] fields are present with correct types", () => {
  assertEquals(typeof validSnapshot.traceId, "string");
  assertEquals(typeof validSnapshot.path, "string");
  assertEquals(typeof validSnapshot.updatedAt, "string");
  assertEquals(typeof validSnapshot.entries["review.summary"], "string");
});

Deno.test("[IFlowNamespaceService] writeEntries accepts declared binding shape", async () => {
  const service: IFlowNamespaceService = new StubFlowNamespaceService();
  const writes: IFlowNamespaceWrite[] = [
    { key: "review.summary", from: "summary", mode: "write" },
    { key: "review.notes", mode: "append" },
  ];

  const snapshot = await service.writeEntries("trace-123", "review", writes, "step-output");

  assertEquals(snapshot.traceId, "trace-123");
  assertEquals(snapshot.entries["review.summary"], "step-output:summary");
  assertEquals(snapshot.entries["review.notes"], "step-output");
});

Deno.test("[NamespaceQuotaExceededError] preserves message and error name", async () => {
  const error = new NamespaceQuotaExceededError("trace-123", 70000, 65536);

  assertEquals(error.name, "NamespaceQuotaExceededError");
  await assertRejects(
    () => Promise.reject(error),
    NamespaceQuotaExceededError,
    "Namespace quota exceeded for trace-123: 70000 bytes > 65536 limit",
  );
});

Deno.test("[FlowNamespaceService] snapshot returns current entries", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = createMockConfig(tempDir);
  const service = new FlowNamespaceService(config);
  const traceId = "snapshot-test-1";

  try {
    await service.writeEntries(traceId, "step1", [{ key: "foo", mode: "write" }], "bar");
    const snap = await service.snapshot(traceId);
    assertEquals(snap.traceId, traceId);
    assertEquals(snap.entries["foo"], "bar");
  } finally {
    await service.delete(traceId);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[FlowNamespaceService] restore restores previously captured entries", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = createMockConfig(tempDir);
  const service = new FlowNamespaceService(config);
  const traceId = "restore-test-1";

  try {
    await service.writeEntries(traceId, "step1", [{ key: "alpha", mode: "write" }], "first");
    await service.writeEntries(traceId, "step2", [{ key: "beta", mode: "write" }], "second");

    const snap = await service.snapshot(traceId);

    await service.writeEntries(traceId, "step3", [{ key: "gamma", mode: "write" }], "third");
    const beforeRestore = await service.load(traceId);
    assertEquals(beforeRestore.entries["gamma"], "third");

    await service.restore(traceId, snap);
    const afterRestore = await service.load(traceId);
    assertEquals(afterRestore.entries["alpha"], "first");
    assertEquals(afterRestore.entries["beta"], "second");
    assertEquals(afterRestore.entries["gamma"], undefined);
  } finally {
    await service.delete(traceId);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[FlowNamespaceService] snapshot/restore round-trip preserves all data", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = createMockConfig(tempDir);
  const service = new FlowNamespaceService(config);
  const traceId = "roundtrip-test-1";

  try {
    await service.writeEntries(traceId, "step1", [{ key: "x", mode: "write" }, { key: "y", mode: "write" }], "value");
    const snap = await service.snapshot(traceId);
    await service.restore(traceId, snap);
    const final = await service.load(traceId);
    assertEquals(final.entries["x"], "value");
    assertEquals(final.entries["y"], "value");
    assertEquals(Object.keys(final.entries).length, 2);
  } finally {
    await service.delete(traceId);
    await Deno.remove(tempDir, { recursive: true });
  }
});
