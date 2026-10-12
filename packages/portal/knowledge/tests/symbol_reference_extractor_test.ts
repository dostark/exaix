/**
 * @module SymbolReferenceExtractorTest
 * @path packages/portal/knowledge/tests/symbol_reference_extractor_test.ts
 * @description Tests for the symbol-reference extractor seam (Phase 178 Step 2):
 * the empty registry contract, the no-op extractor, and the PortalKnowledgeService
 * constructor and analyze() gating for an absent or empty reference registry.
 */

import { assert, assertEquals } from "@std/assert";
import { PortalAnalysisMode } from "@exaix/core";
import type { IMemoryBankService, IPortalKnowledgeConfig } from "@exaix/core/types";
import { PortalKnowledgeService } from "@exaix/portal/knowledge";
import type { IPortalKnowledgeRelationship } from "@exaix/schemas/portal_knowledge.ts";
import {
  createDefaultSymbolReferenceExtractorRegistry,
  EMPTY_SYMBOL_REFERENCE_EXTRACTOR,
  type ISymbolReferenceExtractor,
} from "@exaix/portal/knowledge";

function makeConfig(overrides: Partial<IPortalKnowledgeConfig> = {}): IPortalKnowledgeConfig {
  return {
    autoAnalyzeOnMount: false,
    defaultMode: PortalAnalysisMode.QUICK,
    quickScanLimit: 10,
    maxFilesToRead: 5,
    ignorePatterns: [],
    staleness: 168,
    useLlmInference: false,
    relevanceSearchEmbeddingEnabled: false,
    enableAstAnalysis: false,
    enableTestExecution: false,
    enableVulnerabilityScan: false,
    enableGitHistoryAnalysis: false,
    ...overrides,
  };
}

function makeFakeMemoryBank(): IMemoryBankService {
  return {
    getProjectMemory: () => Promise.resolve(null),
    createProjectMemory: () => Promise.resolve(undefined),
    updateProjectMemory: () => Promise.resolve(undefined),
    listProjectMemories: () => Promise.resolve([]),
  } as Partial<IMemoryBankService> as IMemoryBankService;
}

Deno.test("[symbol-reference registry] an unregistered language resolves to the no-op extractor, never undefined", () => {
  const registry = createDefaultSymbolReferenceExtractorRegistry();

  assertEquals(registry.getForLanguage("go"), EMPTY_SYMBOL_REFERENCE_EXTRACTOR);
  assertEquals(registry.getForLanguage("java"), EMPTY_SYMBOL_REFERENCE_EXTRACTOR);
  assertEquals(registry.getForLanguage("rust"), EMPTY_SYMBOL_REFERENCE_EXTRACTOR);
  assertEquals(registry.getForLanguage("ruby"), EMPTY_SYMBOL_REFERENCE_EXTRACTOR);
});

Deno.test("[symbol-reference registry] the no-op extractor resolves empty for any language", async () => {
  const registry = createDefaultSymbolReferenceExtractorRegistry();
  const extractor = registry.getForLanguage("go");

  const edges = await extractor.extractReferences("/tmp/does-not-matter", ["a.go"], {
    primaryLanguage: "go",
    knownSymbols: [],
    fileImportEdges: [],
  });

  assertEquals(edges, []);
});

Deno.test("[symbol-reference registry] a registered extractor wins over the no-op for that language only", () => {
  const registry = createDefaultSymbolReferenceExtractorRegistry();
  const stub: ISymbolReferenceExtractor = {
    extractReferences: (): Promise<IPortalKnowledgeRelationship[]> => Promise.resolve([]),
  };

  registry.register("Go", stub);

  assertEquals(registry.getForLanguage("go"), stub);
  assertEquals(registry.getForLanguage("GO"), stub);
  assertEquals(registry.getForLanguage("java"), EMPTY_SYMBOL_REFERENCE_EXTRACTOR);
});

Deno.test("[PortalKnowledgeService] constructor accepts an absent symbolReferenceExtractorRegistry and analyze() does not throw", async () => {
  const service = new PortalKnowledgeService({
    config: makeConfig(),
    memoryBank: makeFakeMemoryBank(),
  });

  const portalRoot = await Deno.makeTempDir({ prefix: "exa_symref_absent_" });
  try {
    await Deno.writeTextFile(`${portalRoot}/main.ts`, "export const x = 1;\n");
    const knowledge = await service.analyze("absent-registry", portalRoot, PortalAnalysisMode.STANDARD);
    assertEquals(knowledge.portal, "absent-registry");
  } finally {
    await Deno.remove(portalRoot, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] analyze() performs no reference extraction when the flag is unset, even with a registered extractor", async () => {
  let calls = 0;
  const registry = createDefaultSymbolReferenceExtractorRegistry();
  registry.register("typescript", {
    extractReferences: (): Promise<IPortalKnowledgeRelationship[]> => {
      calls += 1;
      return Promise.resolve([]);
    },
  });

  const service = new PortalKnowledgeService({
    config: makeConfig({ enableSymbolLevelDependencyGraph: false }),
    memoryBank: makeFakeMemoryBank(),
    symbolReferenceExtractorRegistry: registry,
  });

  const portalRoot = await Deno.makeTempDir({ prefix: "exa_symref_off_" });
  try {
    await Deno.writeTextFile(`${portalRoot}/main.ts`, "export const x = 1;\n");
    await service.analyze("flag-off", portalRoot, PortalAnalysisMode.STANDARD);
    assertEquals(calls, 0, "the flag must gate the pass, not the registry's presence");
  } finally {
    await Deno.remove(portalRoot, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] binds the capped symbolMap and the merged edge set to the reference extractor", async () => {
  const recorded: {
    knownSymbols?: readonly { name: string }[];
    fileImportEdges?: readonly { from: string; to: string; kind: string }[];
    fileImportEdgesIsResult?: boolean;
  } = {};

  const registry = createDefaultSymbolReferenceExtractorRegistry();
  registry.register("typescript", {
    extractReferences: (_portalPath, _filePaths, options) => {
      recorded.knownSymbols = options.knownSymbols;
      recorded.fileImportEdges = options.fileImportEdges;
      return Promise.resolve([]);
    },
  });

  const service = new PortalKnowledgeService({
    config: makeConfig({ enableSymbolLevelDependencyGraph: true }),
    memoryBank: makeFakeMemoryBank(),
    symbolReferenceExtractorRegistry: registry,
  });

  const portalRoot = await Deno.makeTempDir({ prefix: "exa_symref_bind_" });
  try {
    // A relative import pair so the internal graph produces at least one edge.
    await Deno.writeTextFile(`${portalRoot}/main.ts`, 'import { util } from "./util.ts";\nutil();\n');
    await Deno.writeTextFile(`${portalRoot}/util.ts`, "export function util() {}\n");

    const knowledge = await service.analyze("bind", portalRoot, PortalAnalysisMode.STANDARD);

    assert(Array.isArray(recorded.knownSymbols), "knownSymbols must be passed");
    assert(Array.isArray(recorded.fileImportEdges), "fileImportEdges must be passed");
    assertEquals(
      recorded.knownSymbols!.length <= knowledge.symbolMap.length + 1000,
      true,
      "knownSymbols must be the Strategy 6 symbolMap, not a fresh uncapped extraction",
    );
    // Ordering: the reference pass runs after file resolution.
    assert(
      recorded.fileImportEdges!.length > 0,
      `fileImportEdges must be populated by the earlier pass, got ${JSON.stringify(recorded.fileImportEdges)}`,
    );
    assertEquals(
      recorded.fileImportEdges!.some((e) => e.kind === "file_imports_file_internal"),
      true,
      "the merged set must carry the file-import edges",
    );
  } finally {
    await Deno.remove(portalRoot, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] appends symbol edges to the persisted relationships without duplicates", async () => {
  const registry = createDefaultSymbolReferenceExtractorRegistry();
  registry.register("typescript", {
    extractReferences: () =>
      Promise.resolve([
        { from: "main.ts#run", to: "util.ts#util", kind: "symbol_references_symbol" as const },
      ]),
  });

  const service = new PortalKnowledgeService({
    config: makeConfig({ enableSymbolLevelDependencyGraph: true }),
    memoryBank: makeFakeMemoryBank(),
    symbolReferenceExtractorRegistry: registry,
  });

  const portalRoot = await Deno.makeTempDir({ prefix: "exa_symref_merge_" });
  try {
    await Deno.writeTextFile(`${portalRoot}/main.ts`, 'import { util } from "./util.ts";\nutil();\n');
    await Deno.writeTextFile(`${portalRoot}/util.ts`, "export function util() {}\n");

    const knowledge = await service.analyze("merge", portalRoot, PortalAnalysisMode.STANDARD);
    const edges = knowledge.relationships ?? [];

    const keys = edges.map((e) => `${e.from}|${e.to}|${e.kind}`);
    assertEquals(new Set(keys).size, keys.length, "merged relationships must have no duplicate edge");
    assertEquals(
      edges.some((e) => e.kind === "symbol_references_symbol"),
      true,
      "the symbol edge must be persisted",
    );
  } finally {
    await Deno.remove(portalRoot, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] quick mode leaves relationships undefined even with the flag enabled", async () => {
  const registry = createDefaultSymbolReferenceExtractorRegistry();
  registry.register("typescript", {
    extractReferences: () =>
      Promise.resolve([
        { from: "main.ts#run", to: "util.ts#util", kind: "symbol_references_symbol" as const },
      ]),
  });

  const service = new PortalKnowledgeService({
    config: makeConfig({ enableSymbolLevelDependencyGraph: true }),
    memoryBank: makeFakeMemoryBank(),
    symbolReferenceExtractorRegistry: registry,
  });

  const portalRoot = await Deno.makeTempDir({ prefix: "exa_symref_quick_" });
  try {
    await Deno.writeTextFile(`${portalRoot}/main.ts`, "export const x = 1;\n");
    const knowledge = await service.analyze("quick", portalRoot, PortalAnalysisMode.QUICK);
    assertEquals(knowledge.relationships, undefined);
  } finally {
    await Deno.remove(portalRoot, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] [regression] the flag off reproduces the same relationships as no registry at all", async () => {
  const portalRoot = await Deno.makeTempDir({ prefix: "exa_symref_regress_" });
  try {
    await Deno.writeTextFile(`${portalRoot}/main.ts`, 'import { util } from "./util.ts";\nutil();\n');
    await Deno.writeTextFile(`${portalRoot}/util.ts`, "export function util() {}\n");

    let calls = 0;
    const registry = createDefaultSymbolReferenceExtractorRegistry();
    registry.register("typescript", {
      extractReferences: () => {
        calls += 1;
        return Promise.resolve([
          { from: "main.ts#x", to: "util.ts#util", kind: "symbol_references_symbol" as const },
        ]);
      },
    });

    const withRegistry = new PortalKnowledgeService({
      config: makeConfig({ enableSymbolLevelDependencyGraph: false }),
      memoryBank: makeFakeMemoryBank(),
      symbolReferenceExtractorRegistry: registry,
    });
    const withoutRegistry = new PortalKnowledgeService({
      config: makeConfig(),
      memoryBank: makeFakeMemoryBank(),
    });

    const first = await withRegistry.analyze("regress", portalRoot, PortalAnalysisMode.STANDARD);
    const second = await withoutRegistry.analyze("regress", portalRoot, PortalAnalysisMode.STANDARD);

    assertEquals(calls, 0, "the flag must gate the pass even when an extractor is registered");
    assertEquals(first.relationships, second.relationships);
    assertEquals(
      (first.relationships ?? []).some((e) => e.kind === "symbol_references_symbol"),
      false,
    );
  } finally {
    await Deno.remove(portalRoot, { recursive: true });
  }
});
