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
import { NamespaceQuotaExceededError } from "@exaix/flow";

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
