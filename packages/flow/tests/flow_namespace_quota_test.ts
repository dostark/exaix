/**
 * @module FlowNamespaceQuotaTest
 * @path packages/flow-storage/tests/flow_namespace_quota_test.ts
 */

import { assertEquals, assertRejects } from "@std/assert";
import { exists } from "@std/fs";
import { FlowNamespaceService, NamespaceQuotaExceededError } from "@exaix/flow";
import { DEFAULT_NAMESPACE_MAX_BYTES } from "@exaix/core";
import { createMockConfig } from "@exaix/testing";

Deno.test("FlowNamespaceService rejects writes that exceed the namespace quota before persisting", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-flow-namespace-quota-" });

  try {
    const service = new FlowNamespaceService(createMockConfig(tempDir));
    const traceId = "trace-quota-001";
    const namespacePath = service.getNamespacePath(traceId);
    const oversizedOutput = "x".repeat(DEFAULT_NAMESPACE_MAX_BYTES + 1024);
    const writes = Array.from({ length: 9 }, (_value, index) => ({
      key: `review.summary.${index}`,
      mode: "write" as const,
    }));

    await assertRejects(
      () => service.writeEntries(traceId, "review", writes, oversizedOutput),
      NamespaceQuotaExceededError,
    );

    assertEquals(await exists(namespacePath), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
