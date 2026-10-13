/**
 * @module SymbolGraphHarness
 * @path tests/integration/helpers/symbol_graph_harness.ts
 * @description Shared setup for the symbol graph integration tests. It builds the Enterprise registries,
 * a portal knowledge service with the symbol level graph on, and a tool registry that serves one analysed portal.
 * @architectural-layer Test
 * @dependencies ["@exaix/portal", "@exaix/tool-runtime", "@exaix/testing", "@exaix-team/portal-extractors"]
 * @related-files ["tests/integration/symbol_graph_cutover_test.ts", "tests/integration/symbol_graph_language_matrix_test.ts", "tests/integration/symbol_query_tool_selection_test.ts", "tests/integration/symbol_query_live_model_test.ts"]
 */

import { PortalAnalysisMode } from "@exaix/core";
import type { IMemoryBankService, IPortalKnowledgeConfig, IPortalKnowledgeService } from "@exaix/core/types";
import type { ISeamRegistryPlaceholder } from "@exaix/core/composer";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import {
  createDefaultSymbolExtractorRegistry,
  createDefaultSymbolFileResolverRegistry,
  createDefaultSymbolReferenceExtractorRegistry,
  PortalKnowledgeService,
} from "@exaix/portal/knowledge";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";
import { EnterpriseSymbolGraphModule, PortalExtractorsModule } from "@exaix-team/portal-extractors";

/** The three registries that an Enterprise composition fills. */
export interface IEnterpriseRegistries {
  symbolRegistry: ReturnType<typeof createDefaultSymbolExtractorRegistry>;
  referenceRegistry: ReturnType<typeof createDefaultSymbolReferenceExtractorRegistry>;
  fileResolverRegistry: ReturnType<typeof createDefaultSymbolFileResolverRegistry>;
}

/** The portal knowledge config of every symbol graph test. Only the symbol graph switch varies. */
export function symbolGraphServiceConfig(enableSymbolGraph = true): IPortalKnowledgeConfig {
  return {
    autoAnalyzeOnMount: false,
    defaultMode: PortalAnalysisMode.STANDARD,
    quickScanLimit: 200,
    maxFilesToRead: 50,
    ignorePatterns: [".git"],
    staleness: 168,
    useLlmInference: false,
    relevanceSearchEmbeddingEnabled: false,
    enableAstAnalysis: false,
    enableTestExecution: false,
    enableVulnerabilityScan: false,
    enableGitHistoryAnalysis: false,
    enableSymbolLevelDependencyGraph: enableSymbolGraph,
  };
}

/** A memory bank that holds nothing, so analysis never reads or writes project memory. */
export function fakeMemoryBank(): IMemoryBankService {
  return {
    getProjectMemory: () => Promise.resolve(null),
    createProjectMemory: () => Promise.resolve(undefined),
    updateProjectMemory: () => Promise.resolve(undefined),
    listProjectMemories: () => Promise.resolve([]),
  } as Partial<IMemoryBankService> as IMemoryBankService;
}

/** The registries as the Enterprise composition root fills them.
 *  The Team extractor module supplies the declarations the reference pass reads.
 *  The file resolvers narrow a reference by import edges, so nothing cross-file resolves without them. */
export function enterpriseRegistries(): IEnterpriseRegistries {
  const symbolRegistry = createDefaultSymbolExtractorRegistry();
  const referenceRegistry = createDefaultSymbolReferenceExtractorRegistry();
  const fileResolverRegistry = createDefaultSymbolFileResolverRegistry();

  new PortalExtractorsModule().registerSymbolExtractors(symbolRegistry as ISeamRegistryPlaceholder);

  const enterpriseModule = new EnterpriseSymbolGraphModule();
  enterpriseModule.registerSymbolReferenceExtractors(referenceRegistry as ISeamRegistryPlaceholder);
  enterpriseModule.registerSymbolFileResolvers(fileResolverRegistry as ISeamRegistryPlaceholder);

  return { symbolRegistry, referenceRegistry, fileResolverRegistry };
}

/** Analyses one portal through the real service with the Enterprise composition. */
export async function analyzeWithEnterpriseSymbolGraph(portalRoot: string, alias: string): Promise<IPortalKnowledge> {
  const { symbolRegistry, referenceRegistry, fileResolverRegistry } = enterpriseRegistries();
  const service = new PortalKnowledgeService({
    config: symbolGraphServiceConfig(),
    memoryBank: fakeMemoryBank(),
    symbolExtractorRegistry: symbolRegistry,
    symbolReferenceExtractorRegistry: referenceRegistry,
    symbolFileResolverRegistry: fileResolverRegistry,
  });
  return await service.analyze(alias, portalRoot, PortalAnalysisMode.STANDARD);
}

/** The symbol level edges of one analysed portal. */
export function symbolEdges(knowledge: IPortalKnowledge): NonNullable<IPortalKnowledge["relationships"]> {
  return (knowledge.relationships ?? []).filter((edge) => edge.kind === "symbol_references_symbol");
}

/** A tool registry that serves one analysed portal, so a tool call reads the given knowledge. */
export function buildSymbolToolRegistry(knowledge: IPortalKnowledge, portalRoot: string, alias: string): ToolRegistry {
  const config = createMockConfig(portalRoot, {
    portals: [{
      alias,
      target_path: portalRoot,
      default_branch: "main",
      agents_allowed: ["*"],
      operations: [],
    }],
  });
  const service: IPortalKnowledgeService = {
    analyze: () => Promise.resolve(knowledge),
    getOrAnalyze: () => Promise.resolve(knowledge),
    isStale: () => Promise.resolve(false),
    updateKnowledge: () => Promise.resolve(knowledge),
    getRelevantContext: () => Promise.resolve(undefined),
    queryContext: () => Promise.resolve({ status: "unavailable", reason: "disabled", items: [] } as never),
    loadCachedKnowledge: () => Promise.resolve(knowledge),
  };
  return new ToolRegistry({
    config,
    baseDir: portalRoot,
    context: {
      portalKnowledge: service,
      config: { get: () => config, getAll: () => config },
    } as never,
  });
}
