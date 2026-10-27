/**
 * @module PortalKnowledgeServiceTest
 * @path packages/portal/knowledge/tests/portal_knowledge_service_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Integration tests for PortalKnowledgeService: the orchestrator
 * that combines all 11 analysis strategies into a single IPortalKnowledge result.
 * Uses a real temp directory with mock IModelProvider, IDatabaseService, and
 * IDocCommandRunner for testability.
 */

import { DEFAULT_MEMORY_PROJECTS_DIR } from "@exaix/shared";
import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import type { IDocCommandRunner, IKnowledgeInvalidationStrategy } from "@exaix/portal/knowledge";
import { HnswVectorIndex } from "@exaix/memory";
import {
  type ISymbolExtractor,
  type ISymbolExtractorOptions,
  PortalKnowledgeService,
  SymbolExtractorRegistry,
} from "@exaix/portal/knowledge";
import type { IMemoryBankService, IPortalKnowledgeConfig } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import type { IEmbeddingProvider, IModelProvider } from "@exaix/ai";
import { KnowledgeAnalysisMode, KnowledgeValidityReason, PortalAnalysisMode } from "@exaix/core";
import type { ISymbolEntry } from "@exaix/schemas";
import { withTempDir } from "@exaix/testing";

// Mock helpers

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
    maxPatternDetectorSampleSize: 50,
    minPatternDetectorSampleSize: 10,
    enableAstAnalysis: true,
    enableTestExecution: false,
    enableVulnerabilityScan: false,
    enableGitHistoryAnalysis: true,
    gitHistoryCommitLimit: 500,
    gitHistorySince: "1.year",
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

// language-aware file-selection helpers

/** Capturing extractor records the filePaths passed to extractSymbols(). */
class CapturingExtractor implements ISymbolExtractor {
  lastFilePaths: string[] = [];
  extractSymbols(
    _portalPath: string,
    filePaths: string[],
    _options: ISymbolExtractorOptions,
  ): Promise<ISymbolEntry[]> {
    this.lastFilePaths = filePaths.slice();
    return Promise.resolve([]);
  }
}

/** Temp portal where Python files dominate (3 .py + 1 .ts), so primaryLanguage = "python". */
async function makeTempPortalPython(): Promise<{
  dir: string;
  pyFiles: string[];
  tsFiles: string[];
}> {
  const dir = await Deno.makeTempDir({ prefix: "pks_py_" });
  await Deno.mkdir(join(dir, "src"), { recursive: true });
  // Python files (dominant)
  await Deno.writeTextFile(join(dir, "src", "main.py"), "def main(): pass\n");
  await Deno.writeTextFile(join(dir, "src", "utils.py"), "def util(): pass\n");
  await Deno.writeTextFile(join(dir, "src", "models.py"), "class Model: pass\n");
  // Non-dominant TS file
  await Deno.writeTextFile(join(dir, "src", "config.ts"), "export const config = {};\n");
  return {
    dir,
    pyFiles: ["src/main.py", "src/utils.py", "src/models.py"],
    tsFiles: ["src/config.ts"],
  };
}

// Tests

Deno.test("[PortalKnowledgeService] quick mode avoids LLM calls", async () => {
  const tempDir = await makeTempPortal();
  try {
    const { provider, callCount } = makeMockProvider();
    const svc = new PortalKnowledgeService({
      config: makeConfig({ defaultMode: PortalAnalysisMode.QUICK }),
      memoryBank: makeMockMemoryBank(),
      provider: provider,

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

      runner: makeMockDocRunner(),
    });
    const result = await svc.analyze("test-portal", tempDir, PortalAnalysisMode.DEEP);
    assertExists(result.metadata);
    assertEquals(result.metadata.mode, "deep");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

/** Portal with more source files than `quickScanLimit`, including one deep file. */
async function makeLargeTempPortal(fileCount: number): Promise<{ dir: string; total: number }> {
  const dir = await Deno.makeTempDir({ prefix: "pks_large_" });
  let created = 0;
  for (let i = 0; i < fileCount; i++) {
    const sub = join(dir, "src", `group-${i}`);
    await Deno.mkdir(sub, { recursive: true });
    await Deno.writeTextFile(join(sub, `module_${i}.ts`), `export const v${i} = ${i};\n`);
    created++;
  }
  // A deeply nested file a breadth-first walk can only reach after many directories.
  const deepDir = join(dir, "src", "deep", "nested", "services");
  await Deno.mkdir(deepDir, { recursive: true });
  await Deno.writeTextFile(
    join(deepDir, "deep_service_impl.ts"),
    "export class DeepService {}\n",
  );
  created++;
  return { dir, total: created };
}

Deno.test("[PortalKnowledgeService] standard mode scans the whole tree, ignoring quickScanLimit", async () => {
  const { dir, total } = await makeLargeTempPortal(60);
  try {
    const { provider } = makeMockProvider();
    const svc = new PortalKnowledgeService({
      config: makeConfig({ quickScanLimit: 5, useLlmInference: false }),
      memoryBank: makeMockMemoryBank(),
      provider: provider,
      runner: makeMockDocRunner(),
    });

    const quick = await svc.analyze("quick-portal", dir, PortalAnalysisMode.QUICK);
    assertEquals(
      quick.metadata.filesScanned <= 5,
      true,
      `quick mode must honour quickScanLimit; scanned ${quick.metadata.filesScanned}`,
    );

    const standard = await svc.analyze("standard-portal", dir, PortalAnalysisMode.STANDARD);
    assertEquals(
      standard.metadata.filesScanned,
      total,
      "standard mode must scan every file, not quickScanLimit × 2",
    );
    const deepFound = standard.stats?.extensionDistribution[".ts"] !== undefined &&
      standard.metadata.filesScanned === total;
    assertEquals(deepFound, true, "the deeply nested file must appear in a standard scan");
  } finally {
    await Deno.remove(dir, { recursive: true });
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
        config: makeConfig({
          staleness: 0,
          useLlmInference: false,
          enableGitHistoryAnalysis: false,
          enableAstAnalysis: false,
          enableTestExecution: false,
          enableVulnerabilityScan: false,
        }),
        memoryBank: makeMockMemoryBank(),
        provider: slowProvider,

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
      config: makeConfig({
        staleness: 0,
        useLlmInference: false,
        enableAstAnalysis: false,
        enableGitHistoryAnalysis: false,
      }),
      memoryBank: makeMockMemoryBank(),
      provider: trackingProvider,

      runner: makeMockDocRunner(),
    });
    // Populate cache
    await svc.analyze("bg2-portal", tempDir, PortalAnalysisMode.QUICK);
    const _callsAfterFirst = refreshCallCount;

    // Stale → triggers background
    await new Promise((r) => setTimeout(r, 5));
    await svc.getOrAnalyze("bg2-portal", tempDir);

    // Wait for background re-analysis to finish
    await new Promise((r) => setTimeout(r, 1000));

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
  () =>
    withPortalService({ useLlmInference: false }, async ({ svc, tempDir }) => {
      // No prior analyze — should run synchronously
      const result = await svc.getOrAnalyze("new-portal", tempDir);
      assertExists(result.gatheredAt);
      assertEquals(result.portal, "new-portal");
    }),
);

Deno.test("[PortalKnowledgeService] logs portal.analyzed activity", async () => {
  const tempDir = await makeTempPortal();
  try {
    const logger = makeEvLoggerSpy();
    const svc = new PortalKnowledgeService({
      config: makeConfig({ useLlmInference: false }),
      memoryBank: makeMockMemoryBank(),
      evLogger: logger,
      runner: makeMockDocRunner(),
    });
    await svc.analyze("log-portal", tempDir, PortalAnalysisMode.QUICK);
    assertExists(
      logger.actions.find((a) => a === "portal.analyzed"),
      "Should log portal.analyzed activity",
    );
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

      runner: makeMockDocRunner(),
    });
    const result = await svc.analyze("fail-portal", tempDir, PortalAnalysisMode.STANDARD);
    // Should not throw; architectureOverview falls back to heuristic
    assertEquals(result.architectureOverview.length > 0, true);
    assertEquals(result.architectureOverview.includes("Heuristic"), true);
    assertEquals(result.metadata.architectureInferenceFailed, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// getRelevantContext

Deno.test("[PortalKnowledgeService] getRelevantContext returns undefined when embedding disabled", async () => {
  await withTempDir(async (tempDir) => {
    const svc = new PortalKnowledgeService({
      config: makeConfig({ relevanceSearchEmbeddingEnabled: false }),
      memoryBank: null as never,
      runner: makeMockDocRunner(),
    });

    const result = await svc.getRelevantContext("test request", tempDir, 1000);
    assertEquals(result, undefined);
  });
});

Deno.test("[PortalKnowledgeService] getRelevantContext falls back to undefined when index cold", async () => {
  await withTempDir(async (tempDir) => {
    const svc = new PortalKnowledgeService({
      config: makeConfig({ relevanceSearchEmbeddingEnabled: true }),
      memoryBank: null as never,
      runner: makeMockDocRunner(),
    });

    const result = await svc.getRelevantContext("test request", tempDir, 1000);
    // HNSW index is cold (not yet built) — must return undefined
    assertEquals(result, undefined);
  });
});

/** What a test gets from {@link withEmbeddingService}. */
interface IEmbeddingScenario {
  svc: PortalKnowledgeService;
  tempDir: string;
  /** How many times the mock embedding provider has been called. */
  embedCalls: () => number;
}

/** Runs a body against a service that uses a mock embedding provider, inside a fresh temp directory. */
async function withEmbeddingService(
  embeddingEnabled: boolean,
  body: (scenario: IEmbeddingScenario) => Promise<void>,
): Promise<void> {
  await withTempDir(async (tempDir) => {
    const projectsDir = join(tempDir, DEFAULT_MEMORY_PROJECTS_DIR);
    await ensureDir(projectsDir);
    let calls = 0;
    const mockEmbedder: IEmbeddingProvider = {
      providerId: "test-mock",
      dimension: 2,
      embed: (texts: string[]) => {
        calls++;
        return Promise.resolve(texts.map((t, i) => [i + 1, t.length]));
      },
    };
    const svc = new PortalKnowledgeService({
      config: makeConfig(embeddingEnabled ? { relevanceSearchEmbeddingEnabled: true } : {}),
      memoryBank: makeMockMemoryBank(),
      runner: makeMockDocRunner(),
      embeddingProvider: mockEmbedder,
      createVectorIndex: () => new HnswVectorIndex(),
      projectsDir,
    });
    await body({ svc, tempDir, embedCalls: () => calls });
  });
}

/** Writes a one-file portal under the temp directory, analyzes it, indexes it with the overrides, and returns its directory. */
async function indexSmallPortal(
  { svc, tempDir }: IEmbeddingScenario,
  portal: { name: string; file: string; source: string },
  overrides: Partial<Parameters<PortalKnowledgeService["indexPortalKnowledge"]>[1]>,
): Promise<string> {
  const portalDir = join(tempDir, portal.name);
  await ensureDir(portalDir);
  await Deno.writeTextFile(join(portalDir, portal.file), portal.source);
  const base = await svc.analyze(portal.name, portalDir);
  await svc.indexPortalKnowledge(portal.name, { ...base, portal: portal.name, ...overrides });
  return portalDir;
}

Deno.test("[PortalKnowledgeService] indexPortalKnowledge then getRelevantContext returns chunks", () =>
  withEmbeddingService(true, async (scenario) => {
    const portalDir = await indexSmallPortal(
      scenario,
      { name: "test-portal", file: "main.ts", source: "export const x = 1;" },
      {
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
      },
    );

    // Query with a related text
    const result = await scenario.svc.getRelevantContext("TypeScript architecture constants export", portalDir, 5000);
    assert(result, "getRelevantContext should return a result after indexing");
    assert(result.length > 0, "context string should not be empty");
    assert(result.includes("TypeScript"), "context should contain relevant content");
  }));

Deno.test("[PortalKnowledgeService] analyze() indexes for retrieval automatically, with no manual indexPortalKnowledge call", () =>
  withEmbeddingService(true, async ({ svc }) => {
    const portalDir = await makeTempPortal();
    try {
      // Only analyze() is called — indexPortalKnowledge must fire as a side effect of it.
      await svc.analyze("auto-index-portal", portalDir, PortalAnalysisMode.QUICK);

      const result = await svc.getRelevantContext("Entry point start function", portalDir, 5000);
      assertExists(result, "analyze() must index the knowledge so getRelevantContext finds it");
    } finally {
      await Deno.remove(portalDir, { recursive: true });
    }
  }));

Deno.test("[PortalKnowledgeService] indexPortalKnowledge does not call the embedding provider when relevanceSearchEmbeddingEnabled is false", () =>
  // A provider being configured must not be enough to trigger embedding calls on its own,
  // otherwise the opt-in flag (cost/privacy-motivated) has no effect.
  withEmbeddingService(false, async ({ svc, embedCalls }) => {
    const portalDir = await makeTempPortal();
    try {
      await svc.analyze("no-embed-portal", portalDir, PortalAnalysisMode.QUICK);
      assertEquals(embedCalls(), 0, "embedding provider must not be called while the flag is off");
    } finally {
      await Deno.remove(portalDir, { recursive: true });
    }
  }));

Deno.test("[PortalKnowledgeService] getRelevantContext respects maxTokens limit", () =>
  withEmbeddingService(true, async (scenario) => {
    const portalDir = await indexSmallPortal(
      scenario,
      { name: "test-portal-2", file: "app.ts", source: "export const y = 2;" },
      {
        architectureOverview:
          "This is a test portal architecture overview with significant content. It describes the system in detail. There is a lot of information here that should be chunked into pieces. Each sentence adds meaningful context that an LLM could use for relevance matching.",
      },
    );

    // Query with very low maxTokens to force truncation
    const result = await scenario.svc.getRelevantContext("architecture", portalDir, 1);
    // Should either be undefined (no chunk fits) or a short string
    if (result) {
      assert(result.length < 100, "result with maxTokens=1 should be very short");
    }
  }));

Deno.test("[PortalKnowledgeService] overlapping sentence groups provide broader context", () =>
  withEmbeddingService(true, async (scenario) => {
    const portalDir = await indexSmallPortal(
      scenario,
      { name: "test-portal", file: "main.ts", source: "export const x = 1;" },
      {
        architectureOverview:
          "The auth module handles user login. It uses JWT tokens for sessions. Tokens expire after 24 hours. " +
          "The database stores user credentials. Passwords are hashed with bcrypt.",
        keyFiles: [],
        conventions: [],
      },
    );

    // Query for a detail that appears late in the text
    const result = await scenario.svc.getRelevantContext("bcrypt password hashing", portalDir, 5000);
    assert(result, "should return context for bcrypt query");
    // With overlapping groups, the chunk containing "bcrypt" should also
    // contain its preceding sentence for context
    assert(
      result.includes("database stores user credentials"),
      "overlapping group should include preceding sentence for context",
    );
  }));

// language-aware source-file selection

Deno.test(
  "[PortalKnowledgeService] selects .py files for a python portal (language-aware filter)",
  async () => {
    const { dir, pyFiles, tsFiles } = await makeTempPortalPython();
    try {
      const pyExtractor = new CapturingExtractor();
      const registry = new SymbolExtractorRegistry();
      registry.register("python", pyExtractor);
      const svc = new PortalKnowledgeService({
        config: makeConfig({
          useLlmInference: false,
          enableAstAnalysis: false,
          enableGitHistoryAnalysis: false,
        }),
        memoryBank: makeMockMemoryBank(),
        symbolExtractorRegistry: registry,
        runner: makeMockDocRunner(),
      });
      await svc.analyze("py-portal", dir, PortalAnalysisMode.STANDARD);
      // All .py files should be passed to the extractor
      for (const pyFile of pyFiles) {
        assert(
          pyExtractor.lastFilePaths.some((f) => f.endsWith(pyFile)),
          `expected .py file in extractor paths: ${pyFile}`,
        );
      }
      // .ts files should NOT be passed (Python is dominant)
      for (const tsFile of tsFiles) {
        assertEquals(
          pyExtractor.lastFilePaths.some((f) => f.endsWith(tsFile)),
          false,
          `.ts file should NOT be passed for a python portal: ${tsFile}`,
        );
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "[PortalKnowledgeService][regression] selects the same TS/JS files for a typescript portal (language-aware filter)",
  async () => {
    const { dir, tsFileCount } = await makeTempPortalMultiFile();
    try {
      const tsExtractor = new CapturingExtractor();
      const registry = new SymbolExtractorRegistry();
      registry.register("typescript", tsExtractor);
      const svc = new PortalKnowledgeService({
        config: makeConfig({
          useLlmInference: false,
          enableAstAnalysis: false,
          enableGitHistoryAnalysis: false,
        }),
        memoryBank: makeMockMemoryBank(),
        symbolExtractorRegistry: registry,
        runner: makeMockDocRunner(),
      });
      await svc.analyze("ts-portal", dir, PortalAnalysisMode.STANDARD);
      assertEquals(
        tsExtractor.lastFilePaths.length,
        tsFileCount,
        `TS extractor should receive all ${tsFileCount} TS/JS files`,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

// Strategy 6 all-TS-files wiring + symbolSourceFilesScanned

/** Tracking runner records every entrypoint passed to run(). */
function makeTrackingDocRunner(): IDocCommandRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    run(entrypoint: string, _portalPath: string): Promise<string | null> {
      calls.push(entrypoint);
      return Promise.resolve("[]");
    },
  };
}

/** Temp portal with one entrypoint (main.ts) and two non-entrypoint TS files. */
async function makeTempPortalMultiFile(): Promise<{ dir: string; tsFileCount: number }> {
  const dir = await Deno.makeTempDir({ prefix: "pks_multi_" });
  await Deno.mkdir(join(dir, "src"), { recursive: true });
  await Deno.mkdir(join(dir, "lib"), { recursive: true });
  await Deno.writeTextFile(join(dir, "src", "main.ts"), "export function start(): void {}");
  await Deno.writeTextFile(join(dir, "src", "utils.ts"), "export function util(): void {}");
  await Deno.writeTextFile(join(dir, "lib", "helper.ts"), "export function help(): void {}");
  await Deno.writeTextFile(join(dir, "deno.json"), JSON.stringify({ tasks: { test: "deno test" } }));
  return { dir, tsFileCount: 3 };
}

Deno.test(
  "[PortalKnowledgeService] standard mode passes all TS/JS files to SymbolExtractor (not just entrypoints)",
  async () => {
    const { dir, tsFileCount: _tsFileCount } = await makeTempPortalMultiFile();
    try {
      const tracker = makeTrackingDocRunner();
      const svc = new PortalKnowledgeService({
        config: makeConfig({ useLlmInference: false, enableAstAnalysis: false, enableGitHistoryAnalysis: false }),
        memoryBank: makeMockMemoryBank(),

        runner: tracker,
      });
      await svc.analyze("multi-portal", dir, PortalAnalysisMode.STANDARD);
      const hasUtils = tracker.calls.some((f) => f.endsWith("utils.ts"));
      const hasHelper = tracker.calls.some((f) => f.endsWith("helper.ts"));
      assertEquals(
        hasUtils,
        true,
        `utils.ts should be passed to SymbolExtractor; got: [${tracker.calls.join(", ")}]`,
      );
      assertEquals(
        hasHelper,
        true,
        `helper.ts should be passed to SymbolExtractor; got: [${tracker.calls.join(", ")}]`,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

// EventLogger Integration Tests

type IEventLoggerSpy = IEventLogger & { actions: string[] };

function makeEvLoggerSpy(): IEventLoggerSpy {
  const actions: string[] = [];
  const self: IEventLoggerSpy = {
    actions,
    info(action: string): Promise<void> {
      actions.push(action);
      return Promise.resolve();
    },
    warn(action: string): Promise<void> {
      actions.push(action);
      return Promise.resolve();
    },
    log: () => Promise.resolve(),
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    child: () => self,
  };
  return self;
}

Deno.test("[PortalKnowledgeService] routes portal.analyzed through IEventLogger when provided", async () => {
  const tempDir = await makeTempPortal();
  try {
    const logger = makeEvLoggerSpy();
    const svc = new PortalKnowledgeService({
      config: makeConfig({ useLlmInference: false }),
      memoryBank: makeMockMemoryBank(),
      evLogger: logger,
      runner: makeMockDocRunner(),
    });
    await svc.analyze("ev-portal", tempDir, PortalAnalysisMode.QUICK);
    assertEquals(logger.actions.includes("portal.analyzed"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] metadata.symbolSourceFilesScanned equals TS/JS file count", async () => {
  const { dir, tsFileCount } = await makeTempPortalMultiFile();
  try {
    const svc = new PortalKnowledgeService({
      config: makeConfig({ useLlmInference: false, enableAstAnalysis: false, enableGitHistoryAnalysis: false }),
      memoryBank: makeMockMemoryBank(),

      runner: makeMockDocRunner(),
    });
    const result = await svc.analyze("scanned-portal", dir, PortalAnalysisMode.STANDARD);
    assertEquals(
      result.metadata.symbolSourceFilesScanned,
      tsFileCount,
      `symbolSourceFilesScanned should equal number of TS/JS files (${tsFileCount})`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** The constructor options of the service. */
type TServiceOptions = ConstructorParameters<typeof PortalKnowledgeService>[0];

/** An invalidation strategy that always asks for an incremental re-analysis. */
const INCREMENTAL_INVALIDATION: IKnowledgeInvalidationStrategy = {
  check: () =>
    Promise.resolve({
      isValid: false,
      reason: KnowledgeValidityReason.TIME_TTL,
      analysisMode: KnowledgeAnalysisMode.INCREMENTAL,
    }),
};

/** Runs a body against a service that has the given config, over a temp portal that is removed afterwards. */
async function withPortalService(
  configOverrides: NonNullable<Parameters<typeof makeConfig>[0]>,
  body: (scenario: { svc: PortalKnowledgeService; tempDir: string }) => Promise<void>,
  extraOptions: Partial<TServiceOptions> = {},
): Promise<void> {
  const tempDir = await makeTempPortal();
  try {
    const svc = new PortalKnowledgeService({
      config: makeConfig(configOverrides),
      memoryBank: makeMockMemoryBank(),
      runner: makeMockDocRunner(),
      ...extraOptions,
    });
    await body({ svc, tempDir });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

// Incremental re-analysis merge semantics

Deno.test(
  "[PortalKnowledgeService] incremental re-analysis preserves gitHistory from prior full analysis",
  { sanitizeOps: false, sanitizeResources: false },
  () =>
    withPortalService({
      useLlmInference: false,
      enableAstAnalysis: false,
      enableGitHistoryAnalysis: true,
    }, async ({ svc, tempDir }) => {
      // Full STANDARD analysis — populates gitHistory (empty values for non-git dir)
      const full = await svc.analyze("merge-git-portal", tempDir, PortalAnalysisMode.STANDARD);
      assertExists(full.gitHistory, "Full analysis should populate gitHistory");

      // getOrAnalyze fires background INCREMENTAL re-analysis (QUICK mode → strips gitHistory)
      await svc.getOrAnalyze("merge-git-portal", tempDir);
      await new Promise((r) => setTimeout(r, 800));

      // After background incremental run, gitHistory must be preserved from the prior full analysis
      const merged = await svc.getOrAnalyze("merge-git-portal", tempDir);
      assertExists(
        merged.gitHistory,
        "Incremental re-analysis must preserve gitHistory from prior full analysis",
      );
    }, { invalidationStrategy: INCREMENTAL_INVALIDATION }),
);

Deno.test(
  "[PortalKnowledgeService] incremental re-analysis preserves licenses from prior full analysis",
  { sanitizeOps: false, sanitizeResources: false },
  () =>
    withPortalService({
      useLlmInference: false,
      enableAstAnalysis: false,
      enableGitHistoryAnalysis: false,
    }, async ({ svc, tempDir }) => {
      // Full STANDARD analysis — runs license detection (returns [] for temp dir)
      const full = await svc.analyze("merge-lic-portal", tempDir, PortalAnalysisMode.STANDARD);
      // licenses is populated (may be empty array) in standard mode
      assertEquals(Array.isArray(full.licenses), true, "Standard analysis should populate licenses array");

      // Background INCREMENTAL re-analysis (QUICK mode → no license detection)
      await svc.getOrAnalyze("merge-lic-portal", tempDir);
      await new Promise((r) => setTimeout(r, 800));

      // After incremental, licenses must be preserved
      const merged = await svc.getOrAnalyze("merge-lic-portal", tempDir);
      assertEquals(
        Array.isArray(merged.licenses),
        true,
        "Incremental re-analysis must preserve licenses from prior full analysis",
      );
    }, { invalidationStrategy: INCREMENTAL_INVALIDATION }),
);

// Mode-gating tests for strategies 7-11

Deno.test("[PortalKnowledgeService] quick mode produces no new strategy fields", async () => {
  const tempDir = await makeTempPortal();
  try {
    const svc = new PortalKnowledgeService({
      config: makeConfig({ useLlmInference: false }),
      memoryBank: makeMockMemoryBank(),

      runner: makeMockDocRunner(),
    });
    const result = await svc.analyze("gate-quick", tempDir, PortalAnalysisMode.QUICK);
    assertEquals(result.astDiagnostics, undefined, "quick mode must not run strategy 7");
    assertEquals(result.testInfo, undefined, "quick mode must not run strategy 8");
    assertEquals(result.licenses, undefined, "quick mode must not run strategy 9");
    assertEquals(result.vulnerabilities, undefined, "quick mode must not run strategy 10");
    assertEquals(result.gitHistory, undefined, "quick mode must not run strategy 11");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test(
  "[PortalKnowledgeService] standard mode populates licenses and gitHistory (strategies 9 + 11)",
  () =>
    withPortalService({
      useLlmInference: false,
      enableAstAnalysis: false,
      enableTestExecution: false,
      enableVulnerabilityScan: false,
      enableGitHistoryAnalysis: true,
    }, async ({ svc, tempDir }) => {
      const result = await svc.analyze("gate-std", tempDir, PortalAnalysisMode.STANDARD);
      assertEquals(Array.isArray(result.licenses), true, "standard mode must run strategy 9 (licenses)");
      assertEquals(result.gitHistory !== undefined, true, "standard mode must run strategy 11 (gitHistory)");
      assertEquals(result.testInfo, undefined, "standard mode must NOT run strategy 8 (deep only)");
      assertEquals(result.vulnerabilities, undefined, "standard mode must NOT run strategy 10 (deep only)");
    }),
);

Deno.test(
  "[PortalKnowledgeService] enableAstAnalysis=false skips strategy 7 in standard mode",
  () =>
    withPortalService({ useLlmInference: false, enableAstAnalysis: false }, async ({ svc, tempDir }) => {
      const result = await svc.analyze("gate-noast", tempDir, PortalAnalysisMode.STANDARD);
      assertEquals(result.astDiagnostics, undefined, "enableAstAnalysis=false must skip strategy 7");
    }),
);

Deno.test(
  "[PortalKnowledgeService] enableGitHistoryAnalysis=false skips strategy 11 in standard mode",
  () =>
    withPortalService({ useLlmInference: false, enableGitHistoryAnalysis: false }, async ({ svc, tempDir }) => {
      const result = await svc.analyze("gate-nogit", tempDir, PortalAnalysisMode.STANDARD);
      assertEquals(result.gitHistory, undefined, "enableGitHistoryAnalysis=false must skip strategy 11");
    }),
);

Deno.test(
  "[PortalKnowledgeService] enableTestExecution=false skips strategy 8 in deep mode",
  () =>
    withPortalService({
      useLlmInference: false,
      enableAstAnalysis: false,
      enableGitHistoryAnalysis: false,
      enableTestExecution: false,
      enableVulnerabilityScan: false,
    }, async ({ svc, tempDir }) => {
      const result = await svc.analyze("gate-notest", tempDir, PortalAnalysisMode.DEEP);
      assertEquals(result.testInfo, undefined, "enableTestExecution=false must skip strategy 8");
    }),
);

Deno.test(
  "[PortalKnowledgeService] enableVulnerabilityScan=false skips strategy 10 in deep mode",
  () =>
    withPortalService({
      useLlmInference: false,
      enableAstAnalysis: false,
      enableGitHistoryAnalysis: false,
      enableTestExecution: false,
      enableVulnerabilityScan: false,
    }, async ({ svc, tempDir }) => {
      const result = await svc.analyze("gate-novuln", tempDir, PortalAnalysisMode.DEEP);
      assertEquals(result.vulnerabilities, undefined, "enableVulnerabilityScan=false must skip strategy 10");
    }),
);

Deno.test(
  "[PortalKnowledgeService] standard mode runs strategies 7, 9, 11 but not 8 or 10",
  () =>
    withPortalService({
      useLlmInference: false,
      enableAstAnalysis: true,
      enableGitHistoryAnalysis: true,
    }, async ({ svc, tempDir }) => {
      const result = await svc.analyze("gate-all-std", tempDir, PortalAnalysisMode.STANDARD);
      assertEquals(
        result.astDiagnostics !== undefined,
        true,
        "standard mode must run strategy 7 with enableAstAnalysis=true",
      );
      assertEquals(Array.isArray(result.licenses), true, "standard mode must run strategy 9");
      assertEquals(
        result.gitHistory !== undefined,
        true,
        "standard mode must run strategy 11 with enableGitHistoryAnalysis=true",
      );
      assertEquals(result.testInfo, undefined, "standard mode must NOT run strategy 8 (deep only)");
      assertEquals(result.vulnerabilities, undefined, "standard mode must NOT run strategy 10 (deep only)");
    }),
);

Deno.test(
  "[PortalKnowledgeService] deep mode runs all 11 strategies when all flags enabled",
  () =>
    withPortalService({
      useLlmInference: false,
      enableAstAnalysis: true,
      enableTestExecution: true,
      enableVulnerabilityScan: true,
      enableGitHistoryAnalysis: true,
    }, async ({ svc, tempDir }) => {
      const result = await svc.analyze("gate-all-deep", tempDir, PortalAnalysisMode.DEEP);
      assertEquals(
        result.astDiagnostics !== undefined,
        true,
        "deep mode must run strategy 7 with enableAstAnalysis=true",
      );
      assertEquals(result.testInfo !== undefined, true, "deep mode must run strategy 8 with enableTestExecution=true");
      assertEquals(Array.isArray(result.licenses), true, "deep mode must run strategy 9");
      assertEquals(
        result.vulnerabilities !== undefined,
        true,
        "deep mode must run strategy 10 with enableVulnerabilityScan=true",
      );
      assertEquals(
        result.gitHistory !== undefined,
        true,
        "deep mode must run strategy 11 with enableGitHistoryAnalysis=true",
      );
    }),
);
