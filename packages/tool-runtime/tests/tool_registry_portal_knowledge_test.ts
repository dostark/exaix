/**
 * @module ToolRegistryPortalKnowledgeTest
 * @path packages/tool-runtime/tests/tool_registry_portal_knowledge_test.ts
 * @description Phase 198 Step 4 — verifies the Solo-tier query_symbols/get_module_dependencies
 * tools: registered on ToolRegistry, read only cached knowledge (never analyze/getOrAnalyze),
 * apply filters/ranking/traversal correctly, reject malformed input, bound their result to
 * MAX_GRAPH_TOOL_RESULTS/MAX_GRAPH_TOOL_RESULT_TOKENS, and error gracefully on cold/mismatched
 * cache or a non-portal root — never throwing.
 * @architectural-layer Services
 * @related-files [packages/tool-runtime/src/tool_registry.ts, packages/portal/knowledge/relationship_query.ts]
 */

import { assertEquals } from "@std/assert";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";
import { MAX_GRAPH_TOOL_RESULTS, PortalAnalysisMode, ToolName } from "@exaix/core";
import type { IApplicationContext, IPortalKnowledgeService } from "@exaix/core/types";
import { ContextResultStatus, ContextUnavailableReason } from "@exaix/core";
import type { IPortalKnowledge, ISymbolEntry } from "@exaix/schemas/portal_knowledge.ts";

const PORTAL_ALIAS = "test-portal";

function makeKnowledge(overrides: Partial<IPortalKnowledge> = {}): IPortalKnowledge {
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
    techStack: { primaryLanguage: "typescript" },
    symbolMap: [
      {
        name: "PaymentRouter",
        kind: "class",
        file: "src/router.ts",
        signature: "class PaymentRouter",
        pageRankScore: 5,
      },
      { name: "AuthRouter", kind: "class", file: "src/auth.ts", signature: "class AuthRouter", pageRankScore: 10 },
      { name: "helper", kind: "function", file: "src/util.ts", signature: "function helper(): void" },
    ],
    relationships: [
      { from: "src/router.ts", to: "src/auth.ts", kind: "file_imports_file_internal" },
      { from: "src/auth.ts", to: "src/util.ts", kind: "file_imports_file_internal" },
    ],
    stats: { totalFiles: 0, totalDirectories: 0, extensionDistribution: {} },
    metadata: { durationMs: 0, mode: PortalAnalysisMode.STANDARD, filesScanned: 0, filesRead: 0 },
    ...overrides,
  };
}

interface IMockKnowledgeService extends IPortalKnowledgeService {
  getOrAnalyzeCalls: number;
  analyzeCalls: number;
}

function makeMockKnowledgeService(
  cachedKnowledge: IPortalKnowledge | undefined,
): IMockKnowledgeService {
  let getOrAnalyzeCalls = 0;
  let analyzeCalls = 0;
  return {
    get getOrAnalyzeCalls() {
      return getOrAnalyzeCalls;
    },
    get analyzeCalls() {
      return analyzeCalls;
    },
    analyze: () => {
      analyzeCalls++;
      return Promise.reject(new Error("analyze should never be called by query_symbols/get_module_dependencies"));
    },
    getOrAnalyze: () => {
      getOrAnalyzeCalls++;
      return Promise.reject(
        new Error("getOrAnalyze should never be called by query_symbols/get_module_dependencies"),
      );
    },
    isStale: () => Promise.resolve(false),
    updateKnowledge: () => Promise.resolve(cachedKnowledge ?? makeKnowledge()),
    getRelevantContext: () => Promise.resolve(undefined),
    queryContext: () =>
      Promise.resolve({
        status: ContextResultStatus.UNAVAILABLE,
        reason: ContextUnavailableReason.DISABLED,
        items: [],
      }),
    loadCachedKnowledge: () => Promise.resolve(cachedKnowledge),
  };
}

function makeContext(
  config: ReturnType<typeof createMockConfig>,
  service: IPortalKnowledgeService,
): IApplicationContext {
  return {
    portalKnowledge: service,
    config: { get: () => config, getAll: () => config },
  } as IApplicationContext;
}

function makeRegistry(dir: string, knowledge: IPortalKnowledge | undefined): {
  registry: ToolRegistry;
  service: IMockKnowledgeService;
} {
  const config = createMockConfig(dir, {
    portals: [{
      alias: PORTAL_ALIAS,
      target_path: dir,
      default_branch: "main",
      agents_allowed: ["*"],
      operations: [],
    }],
  });
  const service = makeMockKnowledgeService(knowledge);
  const context = makeContext(config, service);
  return { registry: new ToolRegistry({ config, baseDir: dir, context }), service };
}

Deno.test("[ToolRegistry] query_symbols and get_module_dependencies are registered", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-graph-registered-" });
  try {
    const { registry } = makeRegistry(dir, makeKnowledge());
    const names = registry.getTools().map((t) => t.name);
    assertEquals(names.includes(ToolName.QUERY_SYMBOLS), true);
    assertEquals(names.includes(ToolName.GET_MODULE_DEPENDENCIES), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ToolRegistry] query_symbols filters by name/kind/file and ranks by pageRankScore then name/file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-graph-symbols-" });
  try {
    const { registry, service } = makeRegistry(dir, makeKnowledge());

    const all = await registry.execute(ToolName.QUERY_SYMBOLS, {});
    assertEquals(all.success, true);
    const allData = all.data as { symbols: ISymbolEntry[]; truncated: boolean };
    assertEquals(allData.symbols.map((s) => s.name), ["AuthRouter", "PaymentRouter", "helper"]);
    assertEquals(allData.truncated, false);

    const byName = await registry.execute(ToolName.QUERY_SYMBOLS, { name: "router" });
    assertEquals((byName.data as { symbols: ISymbolEntry[] }).symbols.map((s) => s.name), [
      "AuthRouter",
      "PaymentRouter",
    ]);

    const byKind = await registry.execute(ToolName.QUERY_SYMBOLS, { kind: "function" });
    assertEquals((byKind.data as { symbols: ISymbolEntry[] }).symbols.map((s) => s.name), ["helper"]);

    const byFile = await registry.execute(ToolName.QUERY_SYMBOLS, { file: "src/router.ts" });
    assertEquals((byFile.data as { symbols: ISymbolEntry[] }).symbols.map((s) => s.name), ["PaymentRouter"]);

    assertEquals(service.getOrAnalyzeCalls, 0, "query_symbols must never call getOrAnalyze");
    assertEquals(service.analyzeCalls, 0, "query_symbols must never call analyze");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ToolRegistry] query_symbols caps limit at MAX_GRAPH_TOOL_RESULTS and rejects a non-finite/negative/fractional limit", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-graph-symbols-limit-" });
  try {
    const { registry } = makeRegistry(dir, makeKnowledge());

    const capped = await registry.execute(ToolName.QUERY_SYMBOLS, { limit: 999999 });
    assertEquals(capped.success, true);
    assertEquals((capped.data as { symbols: ISymbolEntry[] }).symbols.length <= MAX_GRAPH_TOOL_RESULTS, true);

    for (const invalid of [-1, 0, 1.5, Infinity, NaN]) {
      const result = await registry.execute(ToolName.QUERY_SYMBOLS, { limit: invalid });
      assertEquals(result.success, false, `limit ${invalid} must be rejected`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ToolRegistry] query_symbols rejects absolute, drive-prefixed, and '..' file paths", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-graph-symbols-path-" });
  try {
    const { registry } = makeRegistry(dir, makeKnowledge());
    for (const badPath of ["/etc/passwd", "C:\\secrets.txt", "../outside.ts", "..", ""]) {
      const result = await registry.execute(ToolName.QUERY_SYMBOLS, { file: badPath });
      assertEquals(result.success, false, `file '${badPath}' must be rejected`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ToolRegistry] get_module_dependencies breadth-first traverses forward import edges, capped by depth", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-graph-deps-" });
  try {
    const { registry, service } = makeRegistry(dir, makeKnowledge());

    const depth1 = await registry.execute(ToolName.GET_MODULE_DEPENDENCIES, { path: "src/router.ts" });
    assertEquals(depth1.success, true);
    assertEquals(depth1.data, {
      edges: [{ from: "src/router.ts", to: "src/auth.ts", kind: "file_imports_file_internal" }],
      truncated: false,
    });

    const depth2 = await registry.execute(ToolName.GET_MODULE_DEPENDENCIES, { path: "src/router.ts", depth: 2 });
    assertEquals(depth2.data, {
      edges: [
        { from: "src/router.ts", to: "src/auth.ts", kind: "file_imports_file_internal" },
        { from: "src/auth.ts", to: "src/util.ts", kind: "file_imports_file_internal" },
      ],
      truncated: false,
    });

    assertEquals(service.getOrAnalyzeCalls, 0, "get_module_dependencies must never call getOrAnalyze");
    assertEquals(service.analyzeCalls, 0, "get_module_dependencies must never call analyze");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ToolRegistry] get_module_dependencies rejects a missing path, a depth beyond MAX_GRAPH_TOOL_DEPTH, and non-finite/negative depth", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-graph-deps-invalid-" });
  try {
    const { registry } = makeRegistry(dir, makeKnowledge());

    const noPath = await registry.execute(ToolName.GET_MODULE_DEPENDENCIES, {});
    assertEquals(noPath.success, false);

    const tooDeep = await registry.execute(ToolName.GET_MODULE_DEPENDENCIES, { path: "src/router.ts", depth: 4 });
    assertEquals(tooDeep.success, false);

    for (const invalid of [-1, 0, 1.5, Infinity, NaN]) {
      const result = await registry.execute(ToolName.GET_MODULE_DEPENDENCIES, {
        path: "src/router.ts",
        depth: invalid,
      });
      assertEquals(result.success, false, `depth ${invalid} must be rejected`);
    }

    const badPath = await registry.execute(ToolName.GET_MODULE_DEPENDENCIES, { path: "../outside.ts" });
    assertEquals(badPath.success, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ToolRegistry] query_symbols and get_module_dependencies error gracefully on a cold cache, a portal mismatch, no service, and no matching portal", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-graph-cold-" });
  try {
    const { registry: coldRegistry } = makeRegistry(dir, undefined);
    const cold = await coldRegistry.execute(ToolName.QUERY_SYMBOLS, {});
    assertEquals(cold.success, false);
    assertEquals(typeof cold.error, "string");

    const mismatched = makeKnowledge({ portal: "other-portal" });
    const { registry: mismatchRegistry } = makeRegistry(dir, mismatched);
    const mismatchResult = await mismatchRegistry.execute(ToolName.GET_MODULE_DEPENDENCIES, { path: "src/router.ts" });
    assertEquals(mismatchResult.success, false);

    const noServiceConfig = createMockConfig(dir, {
      portals: [{
        alias: PORTAL_ALIAS,
        target_path: dir,
        default_branch: "main",
        agents_allowed: ["*"],
        operations: [],
      }],
    });
    const noServiceRegistry = new ToolRegistry({ config: noServiceConfig, baseDir: dir });
    const noService = await noServiceRegistry.execute(ToolName.QUERY_SYMBOLS, {});
    assertEquals(noService.success, false);

    const noPortalConfig = createMockConfig(dir, { portals: [] });
    const noPortalContext = makeContext(noPortalConfig, makeMockKnowledgeService(makeKnowledge()));
    const noPortalRegistry = new ToolRegistry({ config: noPortalConfig, baseDir: dir, context: noPortalContext });
    const noPortal = await noPortalRegistry.execute(ToolName.GET_MODULE_DEPENDENCIES, { path: "src/router.ts" });
    assertEquals(noPortal.success, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ToolRegistry][security] query_symbols bounds an oversized result to MAX_GRAPH_TOOL_RESULT_TOKENS and reports truncation", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-graph-oversized-" });
  try {
    const manySymbols: ISymbolEntry[] = Array.from({ length: MAX_GRAPH_TOOL_RESULTS }, (_, i) => ({
      name: `Symbol${i}`,
      kind: "function" as const,
      file: `src/file${i}.ts`,
      signature: `function Symbol${i}(): void`,
      doc: "x".repeat(2000),
    }));
    const { registry, service } = makeRegistry(dir, makeKnowledge({ symbolMap: manySymbols }));

    const result = await registry.execute(ToolName.QUERY_SYMBOLS, {});
    assertEquals(result.success, true);
    const data = result.data as { symbols: ISymbolEntry[]; truncated: boolean };
    assertEquals(data.truncated, true);
    for (const symbol of data.symbols) {
      assertEquals((symbol.doc?.length ?? 0) < 2000, true);
    }
    assertEquals(service.getOrAnalyzeCalls, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
