/**
 * @module FlowNamespaceDotpathSafetyTest
 * @path packages/flow/tests/flow_namespace_dotpath_safety_test.ts
 * @related-files []
 * @architectural-layer Flow
 * @description TODO: Add description
 */

import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { FlowNamespaceService } from "@exaix/flow";
import { createMockConfig } from "@exaix/testing";

Deno.test("FlowNamespaceService rejects invalid keys, falls back on non-JSON dot-path reads, and caps extracted values", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-flow-namespace-safety-" });

  try {
    const service = new FlowNamespaceService(createMockConfig(tempDir));
    const warnSpy = spy(console, "warn");

    try {
      await service.writeEntries("trace-safety-001", "review", [{ key: "unsafe\nkey", mode: "write" }], "ignored");
      const invalidKeySnapshot = await service.load("trace-safety-001");
      assertEquals(invalidKeySnapshot.entries, {});

      await service.writeEntries(
        "trace-safety-002",
        "review",
        [{ key: "review.summary", from: "summary", mode: "write" }],
        "plain text summary",
      );
      const fallbackSnapshot = await service.load("trace-safety-002");
      assertEquals(fallbackSnapshot.entries["review.summary"], "plain text summary");

      await service.writeEntries(
        "trace-safety-003",
        "review",
        [{ key: "review.large", from: "summary", mode: "write" }],
        JSON.stringify({ summary: "x".repeat(10000) }),
      );
      const cappedSnapshot = await service.load("trace-safety-003");
      assertEquals(cappedSnapshot.entries["review.large"].length, 8192);
    } finally {
      warnSpy.restore();
    }

    assertSpyCalls(warnSpy, 2);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
