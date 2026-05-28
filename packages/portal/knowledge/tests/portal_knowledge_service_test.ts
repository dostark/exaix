/**
 * @module PortalKnowledgeServiceTest
 * @path packages/portal/knowledge/tests/portal_knowledge_service_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Integration tests for PortalKnowledgeService: the orchestrator
 * that combines all 6 analysis strategies (DirectoryAnalyzer, ConfigParser,
 * KeyFileIdentifier, PatternDetector, ArchitectureInferrer, SymbolExtractor)
 * into a single IPortalKnowledge result. Uses a real temp directory with mock
 * IModelProvider, IDatabaseService, and IDocCommandRunner for testability.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { type IDocCommandRunner, PortalKnowledgeService } from "@exaix/portal/knowledge";
import type { IDatabaseService, IMemoryBankService, IPortalKnowledgeConfig } from "@exaix/core/types";
import type { IEmbeddingProvider, IModelProvider } from "@exaix/ai";
import { PortalAnalysisMode } from "@exaix/core";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type ILoggedActivity = {
  actor: string;
  actionType: string;
  target: string | null;
};

function makeMockDb(): IDatabaseService & { activities: ILoggedActivity[] } {
  const activities: ILoggedActivity[] = [];
  return {
    activities,
    logActivity(actor: string, actionType: string, target: string | null) {
      activities.push({ actor, actionType, target });
    },
    waitForFlush: () => Promise.resolve(),
    queryActivity: () => Promise.resolve([]),
    close: () => Promise.resolve(),
    preparedGet: () => Promise.resolve(null),
    preparedAll: () => Promise.resolve([]),
    preparedRun: () => Promise.resolve(),
    execute: () => Promise.resolve(),
    transaction: <T>(fn: () => Promise<T>) => fn(),
  } as Partial<IDatabaseService> as IDatabaseService & { activities: ILoggedActivity[] };
}

function makeMockMemoryBank(): IMemoryBankService {
  return {
    getProjectMemory: () => Promise.resolve(null),
    createProjectMemory: () => Promise.resolve(),
    updateProjectMemory: () => Promise.resolve(),
    addPattern: () => Promise.resolve(),
    addDecision: () => Promise.resolve(),
    createExecutionRecord: () => Promise.resolve(),
    getExecutionByTraceId: () => Promise.resolve(null),
    getExecutionHistory: () => Promise.resolve([]),
    getGlobalMemory: () => Promise.resolve(null),
    createGlobalMemory: () => Promise.resolve(),
    updateGlobalMemory: () => Promise.resolve(),
    searchMemory: () => Promise.resolve([]),
    searchMemoryByType: () => Promise.resolve([]),
    deleteProjectMemory: () => Promise.resolve(),
    listProjectMemories: () => Promise.resolve([]),
    getLearnings: () => Promise.resolve([]),
    addLearning: () => Promise.resolve(),
  } as Partial<IMemoryBankService> as IMemoryBankService;
}

function makeMockProvider(response = "## Architecture\n\nA test codebase."): {
  provider: IModelProvider;
  callCount: () => number;
} {
  let calls = 0;
  const provider: IModelProvider = {
    id: "mock",
    generate: (_prompt: string) => {
      calls++;
      return Promise.resolve({
        content: response,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
  return { provider, callCount: () => calls };
}

function makeMockDocRunner(): IDocCommandRunner {
  return { run: () => Promise.resolve("[]") };
}

function makeConfig(overrides: Partial<IPortalKnowledgeConfig> = {}): IPortalKnowledgeConfig {
  return {
    autoAnalyzeOnMount: false,
    defaultMode: PortalAnalysisMode.STANDARD,
    quickScanLimit: 200,
    maxFilesToRead: 10,
    ignorePatterns: [],
    staleness: 24,
    useLlmInference: true,
    relevanceSearchEmbeddingEnabled: false,
    ...overrides,
  };
}

/** Creates a minimal TypeScript project in a temp directory. */
async function makeTempPortal(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "pks_test_" });
  await Deno.mkdir(join(dir, "src"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "src", "main.ts"),
    "/** Entry point. */\nexport function start(): void {}\n",
  );
  await Deno.writeTextFile(
    join(dir, "deno.json"),
    JSON.stringify({ tasks: { test: "deno test" } }),
  );
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("[PortalKnowledgeService] quick mode avoids LLM calls", async () => {
  const tempDir = await makeTempPortal();
  try {
    const { provider, callCount } = makeMockProvider();
    const svc = new PortalKnowledgeService({
      config: makeConfig({ defaultMode: PortalAnalysisMode.QUICK }),
      memoryBank: makeMockMemoryBank(),
      provider: provider,
      db: makeMockDb(),
      runner: makeMockDocRunner(),
    });
    await svc.analyze("test-portal", tempDir, PortalAnalysisMode.QUICK);
    assertEquals(callCount(), 0, "Quick mode must not call the LLM");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] standard mode includes LLM architecture inference", async () => {
  const tempDir = await makeTempPortal();
  try {
    const { provider, callCount } = makeMockProvider();
    const svc = new PortalKnowledgeService({
      config: makeConfig({ useLlmInference: true }),
      memoryBank: makeMockMemoryBank(),
      provider: provider,
      db: makeMockDb(),
      runner: makeMockDocRunner(),
    });
    const result = await svc.analyze("test-portal", tempDir, PortalAnalysisMode.STANDARD);
    assertEquals(callCount() >= 1, true, "Standard mode must call the LLM");
    assertExists(result.architectureOverview);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] deep mode uses higher file read caps", async () => {
  const tempDir = await makeTempPortal();
  try {
    const { provider } = makeMockProvider();
    const svc = new PortalKnowledgeService({
      config: makeConfig({ maxFilesToRead: 5 }),
      memoryBank: makeMockMemoryBank(),
      provider: provider,
      db: makeMockDb(),
      runner: makeMockDocRunner(),
    });
    const result = await svc.analyze("test-portal", tempDir, PortalAnalysisMode.DEEP);
    assertExists(result.metadata);
    assertEquals(result.metadata.mode, "deep");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] merges all strategy results correctly", async () => {
  const tempDir = await makeTempPortal();
  try {
    const { provider } = makeMockProvider();
    const svc = new PortalKnowledgeService({
      config: makeConfig(),
      memoryBank: makeMockMemoryBank(),
      provider: provider,
      db: makeMockDb(),
      runner: makeMockDocRunner(),
    });
    const result = await svc.analyze("test-portal", tempDir);
    assertEquals(result.portal, "test-portal");
    assertExists(result.gatheredAt);
    assertEquals(result.version >= 1, true);
    assertExists(result.techStack.primaryLanguage);
    assertExists(result.stats);
    assertEquals(result.metadata.filesScanned >= 0, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] isStale returns false within threshold", async () => {
  const tempDir = await makeTempPortal();
  try {
    const svc = new PortalKnowledgeService({
      config: makeConfig({ staleness: 24 }),
      memoryBank: makeMockMemoryBank(),
      db: makeMockDb(),
      runner: makeMockDocRunner(),
    });
    await svc.analyze("fresh-portal", tempDir, PortalAnalysisMode.QUICK);
    assertEquals(await svc.isStale("fresh-portal"), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] isStale returns true beyond threshold", async () => {
  const tempDir = await makeTempPortal();
  try {
    const svc = new PortalKnowledgeService({
      config: makeConfig({ staleness: 0 }),
      memoryBank: makeMockMemoryBank(),
      db: makeMockDb(),
      runner: makeMockDocRunner(),
    });
    await svc.analyze("stale-portal", tempDir, PortalAnalysisMode.QUICK);
    // With staleness=0 hours, cutoff=Date.now(), so any gathered time is stale
    await new Promise((r) => setTimeout(r, 5));
    assertEquals(await svc.isStale("stale-portal"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] isStale returns true when no cache", async () => {
  const svc = new PortalKnowledgeService({
    config: makeConfig(),
    memoryBank: makeMockMemoryBank(),
    db: makeMockDb(),
    runner: makeMockDocRunner(),
  });
  assertEquals(await svc.isStale("unknown-portal"), true);
});

Deno.test("[PortalKnowledgeService] getOrAnalyze returns cached when fresh", async () => {
  const tempDir = await makeTempPortal();
  try {
    const { provider, callCount } = makeMockProvider();
    const svc = new PortalKnowledgeService({
      config: makeConfig({ staleness: 24, useLlmInference: false }),
      memoryBank: makeMockMemoryBank(),
      provider: provider,
      db: makeMockDb(),
      runner: makeMockDocRunner(),
    });
    // First call populates cache
    const first = await svc.getOrAnalyze("cache-portal", tempDir);
    const callsAfterFirst = callCount();
    // Second call should use cache (no re-analysis)
    const second = await svc.getOrAnalyze("cache-portal", tempDir);
    assertEquals(second.gatheredAt, first.gatheredAt, "Should serve cached result");
    assertEquals(callCount(), callsAfterFirst, "Should not re-run analysis");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test(
  "[PortalKnowledgeService] getOrAnalyze returns stale knowledge immediately without blocking",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const tempDir = await makeTempPortal();
    try {
      let _bgAnalysisTriggered = false;
      // Provider call records whether background analysis ran
      const slowProvider: IModelProvider = {
        id: "slow",
        generate: () => {
          _bgAnalysisTriggered = true;
          return Promise.resolve({
            content: "# Overview updated",
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            model: "slow-model",
            provider: "mock",
            cost_usd: 0,
          });
        },
      };

      const svc = new PortalKnowledgeService({
        config: makeConfig({ staleness: 0, useLlmInference: false }),
        memoryBank: makeMockMemoryBank(),
        provider: slowProvider,
        db: makeMockDb(),
        runner: makeMockDocRunner(),
      });
      // Populate cache
      const stale = await svc.analyze("bg-portal", tempDir, PortalAnalysisMode.QUICK);

      // getOrAnalyze with staleness=0 → returns stale immediately
      const start = Date.now();
      await new Promise((r) => setTimeout(r, 5));
      const returned = await svc.getOrAnalyze("bg-portal", tempDir);
      const elapsed = Date.now() - start;

      // It should return the stale knowledge (same gatheredAt as initial)
      assertEquals(returned.gatheredAt, stale.gatheredAt, "Should return stale knowledge");
      // Should return fast (not wait for LLM)
      assertEquals(elapsed < 2000, true, "Should return stale knowledge without blocking");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test("[PortalKnowledgeService] getOrAnalyze triggers async background re-analysis when stale", {
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  const tempDir = await makeTempPortal();
  try {
    let refreshCallCount = 0;
    const trackingProvider: IModelProvider = {
      id: "tracking",
      generate: () => {
        refreshCallCount++;
        return Promise.resolve({
          content: "# Updated",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: "tracking-model",
          provider: "mock",
          cost_usd: 0,
        });
      },
    };
    const svc = new PortalKnowledgeService({
      config: makeConfig({ staleness: 0, useLlmInference: false }),
      memoryBank: makeMockMemoryBank(),
      provider: trackingProvider,
      db: makeMockDb(),
      runner: makeMockDocRunner(),
    });
    // Populate cache
    await svc.analyze("bg2-portal", tempDir, PortalAnalysisMode.QUICK);
    const _callsAfterFirst = refreshCallCount;

    // Stale → triggers background
    await new Promise((r) => setTimeout(r, 5));
    await svc.getOrAnalyze("bg2-portal", tempDir);

    // Wait for background re-analysis to finish
    await new Promise((r) => setTimeout(r, 200));

    // Background analysis ran (even if no LLM was called in quick mode,
    // the service should have re-analyzed and updated the cache)
    const _afterBg = await svc.isStale("bg2-portal");
    // With staleness=0, will still be stale after re-analysis (always stale with 0 threshold)
    // But the cache version should be incremented
    const refreshed = await svc.getOrAnalyze("bg2-portal", tempDir);
    assertEquals(refreshed.version >= 2, true, "Background analysis should increment version");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test(
  "[PortalKnowledgeService] getOrAnalyze analyzes synchronously when missing",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const tempDir = await makeTempPortal();
    try {
      const svc = new PortalKnowledgeService({
        config: makeConfig({ useLlmInference: false }),
        memoryBank: makeMockMemoryBank(),
        db: makeMockDb(),
        runner: makeMockDocRunner(),
      });
      // No prior analyze — should run synchronously
      const result = await svc.getOrAnalyze("new-portal", tempDir);
      assertExists(result.gatheredAt);
      assertEquals(result.portal, "new-portal");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test("[PortalKnowledgeService] logs portal.analyzed activity", async () => {
  const tempDir = await makeTempPortal();
  try {
    const db = makeMockDb();
    const svc = new PortalKnowledgeService({
      config: makeConfig({ useLlmInference: false }),
      memoryBank: makeMockMemoryBank(),
      db: db,
      runner: makeMockDocRunner(),
    });
    await svc.analyze("log-portal", tempDir, PortalAnalysisMode.QUICK);
    const logged = db.activities.find((a) => a.actionType === "portal.analyzed");
    assertExists(logged, "Should log portal.analyzed activity");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] populates metadata.durationMs", async () => {
  const tempDir = await makeTempPortal();
  try {
    const svc = new PortalKnowledgeService({
      config: makeConfig({ useLlmInference: false }),
      memoryBank: makeMockMemoryBank(),
      db: makeMockDb(),
      runner: makeMockDocRunner(),
    });
    const result = await svc.analyze("meta-portal", tempDir, PortalAnalysisMode.QUICK);
    assertEquals(result.metadata.durationMs >= 0, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] handles LLM failure in standard mode gracefully", async () => {
  const tempDir = await makeTempPortal();
  try {
    const failingProvider: IModelProvider = {
      id: "fail",
      generate: () => Promise.reject(new Error("LLM down")),
    };
    const svc = new PortalKnowledgeService({
      config: makeConfig({ useLlmInference: true }),
      memoryBank: makeMockMemoryBank(),
      provider: failingProvider,
      db: makeMockDb(),
      runner: makeMockDocRunner(),
    });
    const result = await svc.analyze("fail-portal", tempDir, PortalAnalysisMode.STANDARD);
    // Should not throw; architectureOverview falls back to empty
    assertEquals(result.architectureOverview, "");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// getRelevantContext
// ============================================================================

Deno.test("[PortalKnowledgeService] getRelevantContext returns undefined when embedding disabled", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const svc = new PortalKnowledgeService({
      config: makeConfig({ relevanceSearchEmbeddingEnabled: false }),
      memoryBank: null as never,
      runner: makeMockDocRunner(),
    });

    const result = await svc.getRelevantContext("test request", tempDir, 1000);
    assertEquals(result, undefined);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] getRelevantContext falls back to undefined when index cold", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const svc = new PortalKnowledgeService({
      config: makeConfig({ relevanceSearchEmbeddingEnabled: true }),
      memoryBank: null as never,
      runner: makeMockDocRunner(),
    });

    const result = await svc.getRelevantContext("test request", tempDir, 1000);
    // HNSW index is cold (not yet built) — must return undefined
    assertEquals(result, undefined);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] indexPortalKnowledge then getRelevantContext returns chunks", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const projectsDir = join(tempDir, "Memory/Projects");
    await ensureDir(projectsDir);

    const mockEmbedder: IEmbeddingProvider = {
      providerId: "test-mock",
      dimension: 2,
      embed: (texts: string[]) => {
        return Promise.resolve(texts.map((t, i) => [i + 1, t.length]));
      },
    };

    const svc = new PortalKnowledgeService({
      config: makeConfig({ relevanceSearchEmbeddingEnabled: true }),
      memoryBank: null as never,
      runner: makeMockDocRunner(),
      embeddingProvider: mockEmbedder,
      projectsDir,
    });
    const portalDir = join(tempDir, "test-portal");
    await ensureDir(portalDir);
    await Deno.writeTextFile(join(portalDir, "main.ts"), "export const x = 1;");

    // Build a minimal IPortalKnowledge via the service's analyze, then override fields
    const baseKnowledge = await svc.analyze("test-portal", portalDir);

    const knowledge = {
      ...baseKnowledge,
      portal: "test-portal",
      architectureOverview:
        "This is a test portal architecture. It uses TypeScript. The main module exports constants.",
      keyFiles: [{ description: "Entry point for the application", path: "main.ts", role: "entrypoint" as const }],
      conventions: [{
        name: "use-const",
        description: "Always use const for variables",
        category: "naming" as const,
        examples: [],
        evidenceCount: 1,
        confidence: "low" as const,
      }],
    };

    await svc.indexPortalKnowledge("test-portal", knowledge);

    // Query with a related text
    const result = await svc.getRelevantContext("TypeScript architecture constants export", portalDir, 5000);
    assert(result, "getRelevantContext should return a result after indexing");
    assert(result.length > 0, "context string should not be empty");
    assert(result.includes("TypeScript"), "context should contain relevant content");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] getRelevantContext respects maxTokens limit", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const projectsDir = join(tempDir, "Memory/Projects");
    await ensureDir(projectsDir);

    const mockEmbedder: IEmbeddingProvider = {
      providerId: "test-mock",
      dimension: 2,
      embed: (texts: string[]) => {
        return Promise.resolve(texts.map((t, i) => [i + 1, t.length]));
      },
    };

    const svc = new PortalKnowledgeService({
      config: makeConfig({ relevanceSearchEmbeddingEnabled: true }),
      memoryBank: null as never,
      runner: makeMockDocRunner(),
      embeddingProvider: mockEmbedder,
      projectsDir,
    });
    const portalDir2 = join(tempDir, "test-portal-2");
    await ensureDir(portalDir2);
    await Deno.writeTextFile(join(portalDir2, "app.ts"), "export const y = 2;");

    const baseKnowledge2 = await svc.analyze("test-portal-2", portalDir2);

    const knowledge = {
      ...baseKnowledge2,
      portal: "test-portal-2",
      architectureOverview:
        "This is a test portal architecture overview with significant content. It describes the system in detail. There is a lot of information here that should be chunked into pieces. Each sentence adds meaningful context that an LLM could use for relevance matching.",
    };

    await svc.indexPortalKnowledge("test-portal-2", knowledge);

    // Query with very low maxTokens to force truncation
    const result = await svc.getRelevantContext("architecture", portalDir2, 1);
    // Should either be undefined (no chunk fits) or a short string
    if (result) {
      assert(result.length < 100, "result with maxTokens=1 should be very short");
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
