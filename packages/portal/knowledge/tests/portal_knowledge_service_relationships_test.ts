// deno-lint-ignore-file no-explicit-any
/**
 * @module PortalKnowledgeServiceRelationshipsTest
 * @path packages/portal/knowledge/tests/portal_knowledge_service_relationships_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Integration tests for PortalKnowledgeService's relationships field:
 * gating on resolvedMode, real end-to-end population via analyze(), and the
 * incremental-merge-forward behaviour in _revalidateStaleCache.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import {
  type IKnowledgeInvalidationStrategy,
  type IKnowledgeValidityCheck,
  PortalKnowledgeService,
} from "@exaix/portal/knowledge";
import { KnowledgeAnalysisMode, KnowledgeValidityReason, PortalAnalysisMode } from "@exaix/core";
import type { IMemoryBankService, IPortalKnowledgeConfig } from "@exaix/core/types";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import { PortalKnowledgeSchema } from "@exaix/schemas/portal_knowledge.ts";

class FakeInvalidationStrategy implements IKnowledgeInvalidationStrategy {
  constructor(private readonly _result: IKnowledgeValidityCheck) {}

  check(
    _portalPath: string,
    _cached: IPortalKnowledge,
    _stalenessHours: number,
  ): Promise<IKnowledgeValidityCheck> {
    return Promise.resolve(this._result);
  }
}

function makeConfig(overrides: Partial<IPortalKnowledgeConfig> = {}): IPortalKnowledgeConfig {
  return {
    autoAnalyzeOnMount: false,
    defaultMode: PortalAnalysisMode.STANDARD,
    quickScanLimit: 100,
    maxFilesToRead: 20,
    ignorePatterns: [],
    staleness: 168,
    useLlmInference: false,
    relevanceSearchEmbeddingEnabled: false,
    maxPatternDetectorSampleSize: 50,
    minPatternDetectorSampleSize: 10,
    enableAstAnalysis: false,
    enableTestExecution: false,
    enableVulnerabilityScan: false,
    enableGitHistoryAnalysis: false,
    gitHistoryCommitLimit: 500,
    gitHistorySince: "1.year",
    ...overrides,
  };
}

function makeFakeMemoryBank(): IMemoryBankService {
  const bank: any = {
    getProjectMemory: () => Promise.resolve(null),
    createProjectMemory: () => Promise.resolve(undefined),
    updateProjectMemory: () => Promise.resolve(undefined),
    listProjectMemories: () => Promise.resolve([]),
  };
  return bank as IMemoryBankService;
}

function makeFakeKnowledge(overrides: Partial<IPortalKnowledge> = {}): IPortalKnowledge {
  return {
    portal: "test-portal",
    gatheredAt: new Date().toISOString(),
    version: 1,
    architectureOverview: "# Test",
    layers: [],
    keyFiles: [],
    conventions: [],
    dependencies: [],
    packages: undefined,
    techStack: { primaryLanguage: "typescript" },
    symbolMap: [],
    stats: {
      totalFiles: 0,
      totalDirectories: 0,
      extensionDistribution: {},
    },
    metadata: {
      durationMs: 0,
      mode: PortalAnalysisMode.QUICK,
      filesScanned: 0,
      filesRead: 0,
    },
    ...overrides,
  };
}

async function makeFixturePortal(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "exa_relationships_test_" });
  await Deno.writeTextFile(join(root, "main.ts"), `import { util } from "./util.ts";\nutil();\n`);
  await Deno.writeTextFile(join(root, "util.ts"), `export function util() {}\n`);
  return root;
}

Deno.test("[PortalKnowledgeService] analyze() populates relationships in standard mode against a real fixture portal", async () => {
  const root = await makeFixturePortal();
  try {
    const service = new PortalKnowledgeService({
      config: makeConfig(),
      memoryBank: makeFakeMemoryBank(),
    });

    const result = await service.analyze("test-portal", root, PortalAnalysisMode.STANDARD);

    assertExists(result.relationships);
    assertEquals(result.relationships, [
      { from: "main.ts", to: "util.ts", kind: "file_imports_file_internal" },
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] analyze() leaves relationships undefined in quick mode", async () => {
  const root = await makeFixturePortal();
  try {
    const service = new PortalKnowledgeService({
      config: makeConfig(),
      memoryBank: makeFakeMemoryBank(),
    });

    const result = await service.analyze("test-portal", root, PortalAnalysisMode.QUICK);

    assertEquals(result.relationships, undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] astDiagnostics.importGraph remains empty — this phase does not populate the external import graph", async () => {
  const root = await makeFixturePortal();
  try {
    const service = new PortalKnowledgeService({
      config: makeConfig({ enableAstAnalysis: true }),
      memoryBank: makeFakeMemoryBank(),
    });

    const result = await service.analyze("test-portal", root, PortalAnalysisMode.STANDARD);

    assertExists(result.astDiagnostics);
    assertEquals(result.astDiagnostics.importGraph, {});
    // relationships (internal graph) is still populated independently of astDiagnostics.
    assertEquals(result.relationships, [
      { from: "main.ts", to: "util.ts", kind: "file_imports_file_internal" },
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] existing consumers unaffected — schema parses knowledge without relationships (backward compat)", () => {
  const knowledge = makeFakeKnowledge();
  const parsed = PortalKnowledgeSchema.safeParse(knowledge);

  assertEquals(parsed.success, true);
  assertEquals(parsed.success ? parsed.data.relationships : undefined, undefined);
});

Deno.test("[PortalKnowledgeService] _revalidateStaleCache merges relationships forward on incremental re-analysis, matching strategies 7-11", async () => {
  const config = makeConfig();
  const memoryBank = makeFakeMemoryBank();

  const previousRelationships: IPortalKnowledge["relationships"] = [
    { from: "a.ts", to: "b.ts", kind: "file_imports_file_internal" },
  ];
  const previousCache = makeFakeKnowledge({ relationships: previousRelationships });

  const strategy = new FakeInvalidationStrategy({
    analysisMode: KnowledgeAnalysisMode.INCREMENTAL,
    isValid: false,
    reason: KnowledgeValidityReason.SHA_MISMATCH,
    filesDelta: 1,
    cachedSha: "0123456789abcdef0123456789abcdef01234567",
    currentSha: "fedcba9876543210fedcba9876543210fedcba98",
  });

  const service = new PortalKnowledgeService({
    config,
    memoryBank,
    invalidationStrategy: strategy,
  });

  // Simulate what a real QUICK-mode analyze() does: relationships stays undefined
  // (the derivation pass is gated off in QUICK mode), matching strategies 7-11.
  Reflect.set(service, "analyze", async (_portalAlias: string, _portalPath: string) => {
    const fresh = makeFakeKnowledge({ version: 2 });
    Reflect.set(service, "_cache", new Map([["test-portal", fresh]]));
    return await fresh;
  });

  Reflect.set(service, "_cache", new Map([["test-portal", previousCache]]));

  // Call the private method directly (awaited) rather than via getOrAnalyze, which
  // fires it with `void` — awaiting getOrAnalyze does not guarantee completion.
  const revalidate = Reflect.get(service, "_revalidateStaleCache").bind(service);
  await revalidate("test-portal", "/tmp/test-portal", previousCache);

  const merged = Reflect.get(service, "_cache").get("test-portal") as IPortalKnowledge;
  assertEquals(merged.relationships, previousRelationships);
});
