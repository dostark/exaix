/**
 * @module FlowNamespaceMarkdownRenderTest
 * @path packages/flow/tests/flow_namespace_markdown_render_test.ts
 * @related-files []
 * @architectural-layer Flow
 * @description TODO: Add description
 */

import { assertEquals } from "@std/assert";
import type { IFlowNamespaceWrite } from "@exaix/schemas/flow.ts";
import { FlowNamespaceService } from "@exaix/flow";
import { createMockConfig } from "@exaix/testing";

Deno.test("FlowNamespaceService renders markdown deterministically with sorted key order", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-flow-namespace-render-" });

  try {
    const service = new FlowNamespaceService(createMockConfig(tempDir));
    const writes: IFlowNamespaceWrite[] = [
      { key: "zeta.note", mode: "write" },
      { key: "alpha.note", mode: "write" },
    ];

    await service.writeEntries("trace-render-a", "step-a", writes, "shared value");

    const rendered = await Deno.readTextFile(service.getNamespacePath("trace-render-a"));

    assertEquals(rendered.indexOf("## alpha.note") < rendered.indexOf("## zeta.note"), true);
    assertEquals(rendered.includes("authorStepId: step-a"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
