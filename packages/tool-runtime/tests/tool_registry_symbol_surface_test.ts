/**
 * @module ToolRegistrySymbolSurfaceTest
 * @path packages/tool-runtime/tests/tool_registry_symbol_surface_test.ts
 * @description Phase 178 Step 7 — verifies the existing Solo ReAct tool surface
 * against knowledge that carries symbol-level reference edges: the generic
 * relationship tools must return them, and the module-dependency traversal must
 * ignore them entirely.
 * @architectural-layer Services
 * @related-files [packages/tool-runtime/src/tool_registry.ts, packages/portal/knowledge/relationship_query.ts]
 */

import { assertEquals } from "@std/assert";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";
import { ContextResultStatus, ContextUnavailableReason, PortalAnalysisMode, ToolName } from "@exaix/core";
import type { IApplicationContext, IPortalKnowledgeService } from "@exaix/core/types";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";

const PORTAL_ALIAS = "symbol-surface-portal";

/** Knowledge as a paid-edition analysis writes it: file edges plus symbol edges. */
function makeKnowledge(): IPortalKnowledge {
  return {
    portal: PORTAL_ALIAS,
    gatheredAt: new Date().toISOString(),
    version: 1,
    architectureOverview: "# Test",
    layers: [],
    keyFiles: [],
    conventions: [],
    dependencies: [],
    packages: undefined,
    techStack: { primaryLanguage: "go" },
    symbolMap: [],
    relationships: [
      { from: "main.go", to: "helper.go", kind: "file_imports_file_internal" },
      { from: "helper.go", to: "util.go", kind: "file_imports_file_internal" },
      { from: "main.go#Run", to: "helper.go#Double", kind: "symbol_references_symbol" },
      { from: "helper.go#Double", to: "util.go#clamp", kind: "symbol_references_symbol" },
    ],
    stats: { totalFiles: 3, totalDirectories: 1, extensionDistribution: { ".go": 3 } },
    metadata: { durationMs: 0, mode: PortalAnalysisMode.STANDARD, filesScanned: 3, filesRead: 3 },
  };
}

function makeMockKnowledgeService(knowledge: IPortalKnowledge): IPortalKnowledgeService {
  return {
    analyze: () => Promise.resolve(knowledge),
    getOrAnalyze: () => Promise.resolve(knowledge),
    isStale: () => Promise.resolve(false),
    updateKnowledge: () => Promise.resolve(knowledge),
    getRelevantContext: () => Promise.resolve(undefined),
    queryContext: () =>
      Promise.resolve({
        status: ContextResultStatus.UNAVAILABLE,
        reason: ContextUnavailableReason.DISABLED,
        items: [],
      }),
    loadCachedKnowledge: () => Promise.resolve(knowledge),
  };
}

async function withRegistry<T>(
  knowledge: IPortalKnowledge,
  fn: (registry: ToolRegistry) => Promise<T>,
): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "tool-symbol-surface-" });
  try {
    const config = createMockConfig(dir, {
      portals: [{
        alias: PORTAL_ALIAS,
        target_path: dir,
        default_branch: "main",
        agents_allowed: ["*"],
        operations: [],
      }],
    });
    const context = {
      portalKnowledge: makeMockKnowledgeService(knowledge),
      config: { get: () => config, getAll: () => config },
    } as IApplicationContext;
    const registry = new ToolRegistry({ config, baseDir: dir, context });
    return await fn(registry);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("[ToolRegistry] query_relationships returns symbol_references_symbol edges for a bare symbol endpoint", async () => {
  await withRegistry(makeKnowledge(), async (registry) => {
    const result = await registry.execute(ToolName.QUERY_RELATIONSHIPS, {
      from: "main.go#Run",
      kind: "symbol_references_symbol",
    });

    assertEquals(result.success, true);
    assertEquals(result.data, [
      { from: "main.go#Run", to: "helper.go#Double", kind: "symbol_references_symbol" },
    ]);
  });
});

Deno.test("[ToolRegistry] find_dependents returns the reverse symbol edges", async () => {
  await withRegistry(makeKnowledge(), async (registry) => {
    const result = await registry.execute(ToolName.WHO_DEPENDS_ON, { path: "helper.go#Double" });

    assertEquals(result.success, true);
    assertEquals(result.data, [
      { from: "main.go#Run", to: "helper.go#Double", kind: "symbol_references_symbol" },
    ]);
  });
});

Deno.test("[ToolRegistry] get_module_dependencies returns only file edge kinds and no composite node", async () => {
  await withRegistry(makeKnowledge(), async (registry) => {
    const result = await registry.execute(ToolName.GET_MODULE_DEPENDENCIES, {
      path: "main.go",
      depth: 3,
    });

    assertEquals(result.success, true);
    const payload = result.data as { edges: Array<{ from: string; to: string; kind: string }> };
    const edges = payload.edges;
    assertEquals(
      edges.map((e) => `${e.from}->${e.to}`),
      ["main.go->helper.go", "helper.go->util.go"],
      "a symbol edge must never be walked, and no composite endpoint may appear as a node",
    );
    for (const edge of edges) {
      assertEquals(edge.kind, "file_imports_file_internal");
      assertEquals(edge.from.includes("#"), false);
      assertEquals(edge.to.includes("#"), false);
    }
  });
});
