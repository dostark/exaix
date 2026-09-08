/**
 * @module Phase176ScopedContextTest
 * @path packages/portal/knowledge/tests/phase176_scoped_context_test.ts
 * @description Phase 176 Step 1: PortalKnowledgeService must resolve a queried portal
 * path to the alias that was actually analyzed at that path (never the first cache
 * entry — GAP-5), and its structured `queryContext`/`loadCachedKnowledge` API must
 * return typed scores/reasons instead of a plain string.
 * @architectural-layer Portal
 * @related-files [packages/portal/knowledge/portal_knowledge_service.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { PortalKnowledgeService } from "@exaix/portal/knowledge";
import type { IDocCommandRunner } from "@exaix/portal/knowledge";
import type { IMemoryBankService, IPortalKnowledgeConfig } from "@exaix/core/types";
import type { IEmbeddingProvider } from "@exaix/ai";
import { HnswVectorIndex } from "@exaix/memory";
import { ContextItemScoreKind, ContextResultStatus, ContextUnavailableReason, PortalAnalysisMode } from "@exaix/core";

function makeConfig(overrides: Partial<IPortalKnowledgeConfig> = {}): IPortalKnowledgeConfig {
  return {
    autoAnalyzeOnMount: false,
    defaultMode: PortalAnalysisMode.QUICK,
    quickScanLimit: 200,
    maxFilesToRead: 10,
    ignorePatterns: [],
    staleness: 24,
    useLlmInference: false,
    relevanceSearchEmbeddingEnabled: true,
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

function makeMockDocRunner(): IDocCommandRunner {
  return { run: () => Promise.resolve("[]") };
}

/** Deterministic embedder: each text maps to a distinct point so HNSW search is stable. */
function makeMockEmbedder(): IEmbeddingProvider {
  return {
    providerId: "test-mock",
    dimension: 2,
    embed: (texts: string[]) => Promise.resolve(texts.map((t, i) => [i + 1, t.length])),
  };
}

async function makeService(
  tempDir: string,
  configOverrides: Partial<IPortalKnowledgeConfig> = {},
): Promise<PortalKnowledgeService> {
  const projectsDir = join(tempDir, "Memory/Projects");
  await ensureDir(projectsDir);
  return new PortalKnowledgeService({
    config: makeConfig(configOverrides),
    memoryBank: null as never as IMemoryBankService,
    runner: makeMockDocRunner(),
    embeddingProvider: makeMockEmbedder(),
    createVectorIndex: () => new HnswVectorIndex(),
    projectsDir,
  });
}

async function makePortalDir(tempDir: string, name: string): Promise<string> {
  const dir = join(tempDir, name);
  await ensureDir(dir);
  // "main.ts" matches the heuristic entrypoint-filename detector.
  await Deno.writeTextFile(join(dir, "main.ts"), "export const value = 1;");
  return dir;
}

/** Analyzes then re-indexes with a distinguishing overview, since two trivial-fixture
 * portals would otherwise produce identical heuristic chunk text (same pattern as
 * `portal_knowledge_service_test.ts`). */
async function analyzeAndIndexDistinctly(
  svc: PortalKnowledgeService,
  alias: string,
  portalDir: string,
  distinctOverview: string,
): Promise<void> {
  const baseKnowledge = await svc.analyze(alias, portalDir, PortalAnalysisMode.QUICK);
  await svc.indexPortalKnowledge(alias, { ...baseKnowledge, portal: alias, architectureOverview: distinctOverview });
}

Deno.test("[PortalKnowledgeService] getRelevantContext resolves the queried path's own portal, not another cached portal", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const svc = await makeService(tempDir);
    const portalADir = await makePortalDir(tempDir, "portal-a");
    const portalBDir = await makePortalDir(tempDir, "portal-b");

    await analyzeAndIndexDistinctly(svc, "portal-a", portalADir, "Portal Alpha handles authentication.");
    await analyzeAndIndexDistinctly(svc, "portal-b", portalBDir, "Portal Bravo handles billing.");

    const resultA = await svc.getRelevantContext("architecture overview", portalADir, 5000);
    const resultB = await svc.getRelevantContext("architecture overview", portalBDir, 5000);

    assert(resultA, "portal-a's own path must resolve to portal-a's indexed content");
    assert(resultB, "portal-b's own path must resolve to portal-b's indexed content");
    assert(resultA !== resultB, "two distinct portals must not resolve to the same chunk text");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] getRelevantContext is correct regardless of cache insertion order (reversed order)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const svc = await makeService(tempDir);
    const portalADir = await makePortalDir(tempDir, "portal-a");
    const portalBDir = await makePortalDir(tempDir, "portal-b");

    // portal-b is analyzed FIRST, so it is the first entry in the in-memory cache map.
    // A resolver that (bug) falls back to "first cache entry" would incorrectly return
    // portal-b's content when queried with portal-a's own path.
    await analyzeAndIndexDistinctly(svc, "portal-b", portalBDir, "Portal Bravo handles billing.");
    await analyzeAndIndexDistinctly(svc, "portal-a", portalADir, "Portal Alpha handles authentication.");

    const resultForA = await svc.getRelevantContext("architecture overview", portalADir, 5000);
    const resultForB = await svc.getRelevantContext("architecture overview", portalBDir, 5000);

    assert(resultForA, "portal-a's own path must resolve to content, even though it was analyzed second");
    assert(resultForB, "portal-b's own path must still resolve to its own content");
    assert(
      resultForA !== resultForB,
      "querying portal-a's path must never return portal-b's chunk text just because portal-b was cached first",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] getRelevantContext returns undefined for a path that was never analyzed", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const svc = await makeService(tempDir);
    const portalADir = await makePortalDir(tempDir, "portal-a");
    const unknownDir = await makePortalDir(tempDir, "unknown-portal");

    await analyzeAndIndexDistinctly(svc, "portal-a", portalADir, "Portal Alpha handles authentication.");

    const result = await svc.getRelevantContext("architecture overview", unknownDir, 5000);
    assertEquals(result, undefined, "an unregistered/unknown path must never fall back to another cached portal");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] getRelevantContext rejects an ambiguous path claimed by two different aliases", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const svc = await makeService(tempDir);
    const sharedDir = await makePortalDir(tempDir, "shared-portal");

    // Two different aliases both analyzed at the exact same canonical path — this must
    // never resolve to either alias's content by guessing; it is a rejected mapping.
    await analyzeAndIndexDistinctly(svc, "alias-one", sharedDir, "Alias one's overview.");
    await analyzeAndIndexDistinctly(svc, "alias-two", sharedDir, "Alias two's overview.");

    const result = await svc.getRelevantContext("architecture overview", sharedDir, 5000);
    assertEquals(result, undefined, "an ambiguous alias/path mapping must reject, not silently pick one alias");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// queryContext / loadCachedKnowledge — structured, scored API

Deno.test("[PortalKnowledgeService] queryContext returns status:unavailable reason:disabled when embedding is off", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const svc = await makeService(tempDir, { relevanceSearchEmbeddingEnabled: false });
    const portalDir = await makePortalDir(tempDir, "portal-a");
    await analyzeAndIndexDistinctly(svc, "portal-a", portalDir, "Portal Alpha handles authentication.");

    const result = await svc.queryContext({
      portalAlias: "portal-a",
      query: "architecture overview",
      limit: 5,
      maxTokens: 5000,
    });

    assertEquals(result, {
      status: ContextResultStatus.UNAVAILABLE,
      reason: ContextUnavailableReason.DISABLED,
      items: [],
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] queryContext returns status:unavailable reason:cold for an unanalyzed alias", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const svc = await makeService(tempDir);

    const result = await svc.queryContext({
      portalAlias: "never-analyzed",
      query: "architecture overview",
      limit: 5,
      maxTokens: 5000,
    });

    assertEquals(result, { status: ContextResultStatus.UNAVAILABLE, reason: ContextUnavailableReason.COLD, items: [] });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] queryContext returns status:unavailable reason:timeout when the signal is already aborted", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const svc = await makeService(tempDir);
    const portalDir = await makePortalDir(tempDir, "portal-a");
    await analyzeAndIndexDistinctly(svc, "portal-a", portalDir, "Portal Alpha handles authentication.");

    const controller = new AbortController();
    controller.abort();

    const result = await svc.queryContext({
      portalAlias: "portal-a",
      query: "architecture overview",
      limit: 5,
      maxTokens: 5000,
      signal: controller.signal,
    });

    assertEquals(result, {
      status: ContextResultStatus.UNAVAILABLE,
      reason: ContextUnavailableReason.TIMEOUT,
      items: [],
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] queryContext returns scored, provenance-labelled items on a hit", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const svc = await makeService(tempDir);
    const portalDir = await makePortalDir(tempDir, "portal-a");
    await analyzeAndIndexDistinctly(svc, "portal-a", portalDir, "Portal Alpha handles authentication.");

    const result = await svc.queryContext({
      portalAlias: "portal-a",
      query: "architecture overview",
      limit: 5,
      maxTokens: 5000,
    });

    assertEquals(result.status, ContextResultStatus.OK);
    assert(result.items.length > 0, "a real hit must return at least one item");
    for (const item of result.items) {
      assertEquals(item.source, "portal-a");
      assertEquals(item.scoreKind, ContextItemScoreKind.COSINE);
      assertEquals(typeof item.score, "number");
      assert(item.text.length > 0);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] queryContext returns status:unavailable reason:budget_denied when no item fits maxTokens", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const svc = await makeService(tempDir);
    const portalDir = await makePortalDir(tempDir, "portal-a");
    await analyzeAndIndexDistinctly(svc, "portal-a", portalDir, "Portal Alpha handles authentication end to end.");

    const result = await svc.queryContext({
      portalAlias: "portal-a",
      query: "architecture overview",
      limit: 5,
      maxTokens: 1,
    });

    assertEquals(result, {
      status: ContextResultStatus.UNAVAILABLE,
      reason: ContextUnavailableReason.BUDGET_DENIED,
      items: [],
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[PortalKnowledgeService] loadCachedKnowledge returns the cached entry without triggering analysis", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const svc = await makeService(tempDir);
    const portalDir = await makePortalDir(tempDir, "portal-a");

    assertEquals(await svc.loadCachedKnowledge("portal-a"), undefined);

    await svc.analyze("portal-a", portalDir, PortalAnalysisMode.QUICK);
    const cached = await svc.loadCachedKnowledge("portal-a");
    assertEquals(cached?.portal, "portal-a");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
