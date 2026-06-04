// deno-lint-ignore-file no-explicit-any
/**
 * @module PortalKnowledgeServiceInvalidationTest
 * @path packages/portal/knowledge/tests/portal_knowledge_service_invalidation_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Integration tests for PortalKnowledgeService invalidation wiring.
 */

import { assertEquals } from "@std/assert";
import {
  type IKnowledgeInvalidationStrategy,
  type IKnowledgeValidityCheck,
  PortalKnowledgeService,
} from "@exaix/portal/knowledge";
import { KnowledgeAnalysisMode, KnowledgeValidityReason, PortalAnalysisMode } from "@exaix/core";
import type { IMemoryBankService, IPortalKnowledgeConfig } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import type { ILogEvent, LogMetadata } from "@exaix/core";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";

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

function makeConfig(): IPortalKnowledgeConfig {
  return {
    autoAnalyzeOnMount: false,
    defaultMode: PortalAnalysisMode.QUICK,
    quickScanLimit: 10,
    maxFilesToRead: 10,
    ignorePatterns: [],
    staleness: 168,
    useLlmInference: false,
    relevanceSearchEmbeddingEnabled: false,
    maxPatternDetectorSampleSize: 50,
    minPatternDetectorSampleSize: 10,
    enableAstAnalysis: true,
    enableTestExecution: false,
    enableVulnerabilityScan: false,
    enableGitHistoryAnalysis: true,
    gitHistoryCommitLimit: 500,
    gitHistorySince: "1.year",
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

function makeFakeKnowledge(): IPortalKnowledge {
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
  };
}

Deno.test("[PortalKnowledgeService] getOrAnalyze returns cached knowledge when invalidation strategy says skip", async () => {
  const config = makeConfig();
  const memoryBank = makeFakeMemoryBank();
  const cachedKnowledge = makeFakeKnowledge();
  const strategy = new FakeInvalidationStrategy({
    analysisMode: KnowledgeAnalysisMode.SKIP,
    isValid: true,
    reason: KnowledgeValidityReason.SHA_MATCH,
  });
  const service = new PortalKnowledgeService({
    config,
    memoryBank,
    invalidationStrategy: strategy,
  });

  Reflect.set(
    service,
    "_cache",
    new Map([[
      "test-portal",
      cachedKnowledge,
    ]]),
  );

  const result = await service.getOrAnalyze("test-portal", "/tmp/test-portal");

  assertEquals(result, cachedKnowledge);
});

Deno.test("[PortalKnowledgeService] getOrAnalyze uses quick mode on incremental invalidation and logs incremental event", async () => {
  const config = makeConfig();
  const memoryBank = makeFakeMemoryBank();

  const logCalls: Array<{
    action: string;
    target: string | null;
    payload?: LogMetadata;
  }> = [];

  const fakeLogger: IEventLogger = {
    info(action: string, target: string | null, payload?: LogMetadata): Promise<void> {
      logCalls.push({ action, target, payload });
      return Promise.resolve();
    },
    warn: () => Promise.resolve(),
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    log: (_event: ILogEvent) => Promise.resolve(),
    child: function () {
      return fakeLogger;
    },
  };

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
    evLogger: fakeLogger,
    invalidationStrategy: strategy,
  });

  let analyzeCalled = false;
  Reflect.set(service, "analyze", async (_portalAlias: string, _portalPath: string, mode?: PortalAnalysisMode) => {
    analyzeCalled = true;
    assertEquals(mode, PortalAnalysisMode.QUICK);
    return await makeFakeKnowledge();
  });

  Reflect.set(
    service,
    "_cache",
    new Map([["test-portal", makeFakeKnowledge()]]),
  );

  await service.getOrAnalyze("test-portal", "/tmp/test-portal");

  assertEquals(analyzeCalled, true);
  assertEquals(logCalls.length, 1);
  assertEquals(logCalls[0].action, "portal.knowledge.incremental");
  assertEquals(logCalls[0].target, "test-portal");
  assertEquals((logCalls[0].payload as { analysisMode?: string })?.analysisMode, "incremental");
});
