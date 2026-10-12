/**
 * @module SymbolReferenceExtractorTest
 * @path packages/portal/knowledge/tests/symbol_reference_extractor_test.ts
 * @description Tests for the symbol-reference extractor seam (Phase 178 Step 2):
 * the empty registry contract, the no-op extractor, and the PortalKnowledgeService
 * constructor and analyze() gating for an absent or empty reference registry.
 */

import { assertEquals } from "@std/assert";
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
