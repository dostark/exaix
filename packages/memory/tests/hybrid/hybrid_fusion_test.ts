/**
 * @module HybridFusionTest
 * @path packages/memory/tests/hybrid/hybrid_fusion_test.ts
 * @description Verifies hybrid retrieval: weighted keyword+vector score fusion rewards multi-signal agreement (a fused item beats either signal's top single-signal item), the keyword floor keeps results flowing when embeddings are unavailable, learning-type candidates are filtered to APPROVED, and embedded non-learning kinds map to their MemoryType.
 * @architectural-layer Tests
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import { MemoryType } from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { fuseHybridScores, MemoryBankService, SessionMemoryService } from "@exaix/memory";
import type { IEmbeddableMemoryEntry, IMemoryEmbeddingService } from "@exaix/core/types";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import { createSampleLearning, initTestDbService } from "@exaix/testing";

interface IKindResult {
  id: string;
  kind: MemoryType;
  similarity: number;
}

function kindStubEmbedding(results: IKindResult[]): IMemoryEmbeddingService {
  return {
    initializeManifest: () => Promise.resolve(),
    embedLearning: () => Promise.resolve(),
    embed: (_entry: IEmbeddableMemoryEntry) => Promise.resolve(),
    searchByEmbedding: () =>
      Promise.resolve(
        results.map(({ id, kind, similarity }) => ({
          id,
          title: id,
          summary: id,
          similarity,
          kind,
        })),
      ),
    getEmbedding: () => Promise.resolve(null),
    deleteEmbedding: () => Promise.resolve(),
    getStats: () => Promise.resolve({ total: results.length, generated_at: "" }),
  };
}

Deno.test("fuseHybridScores: multi-signal agreement outranks either signal's top single-signal item", () => {
  const vector = new Map([["vector-top", 0.9], ["both", 0.7]]);
  const keyword = new Map([["keyword-top", 0.9], ["both", 0.7]]);

  const fused = fuseHybridScores(vector, keyword, 0.6, 0.4);

  assertEquals(fused.get("both")! > fused.get("vector-top")!, true);
  assertEquals(fused.get("both")! > fused.get("keyword-top")!, true);
  assertAlmostEquals(fused.get("vector-top")!, 0.54);
  assertAlmostEquals(fused.get("keyword-top")!, 0.36);
});

Deno.test("fuseHybridScores: missing signals contribute zero and scoring is deterministic", () => {
  const vector = new Map([["a", 0.5]]);
  const keyword = new Map([["b", 0.5]]);

  const first = fuseHybridScores(vector, keyword, 0.6, 0.4);
  const second = fuseHybridScores(vector, keyword, 0.6, 0.4);

  assertAlmostEquals(first.get("a")!, 0.3);
  assertAlmostEquals(first.get("b")!, 0.2);
  assertEquals(first, second);
});

Deno.test("a fused pattern (both signals) outranks the vector-only and keyword-only patterns", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.createProjectMemory({
      portal: "hybrid-portal",
      overview: "A project for hybrid retrieval testing.",
      patterns: [
        { name: "Repository pattern for data access", description: "Data access via repositories.", examples: [] },
        { name: "Zebra quantum flux", description: "Unrelated exotic pattern.", examples: [] },
        { name: "Repository deployment strategy", description: "Deployment conventions.", examples: [] },
      ],
      decisions: [],
      references: [],
    });
    // Persist the parsed ids as markers so every later parse (including the ones
    // inside searchMemory) returns the same stable ids the vector stub uses.
    await bank.updateProjectMemory("hybrid-portal", {});
    const persisted = (await bank.getProjectMemory("hybrid-portal"))!.patterns;
    const both = persisted.find((p) => p.name.startsWith("Repository pattern"))!;
    const vectorOnly = persisted.find((p) => p.name.startsWith("Zebra"))!;
    const keywordOnly = persisted.find((p) => p.name.startsWith("Repository deployment"))!;

    // "repository" is a substring of the fused and keyword-only names, not the vector-only one.
    const embedding = kindStubEmbedding([
      { id: vectorOnly.id!, kind: MemoryType.PATTERN, similarity: 0.9 },
      { id: both.id!, kind: MemoryType.PATTERN, similarity: 0.8 },
    ]);
    const sessionMemory = new SessionMemoryService(bank, embedding);

    const memories = await sessionMemory.lookupMemories("repository", undefined);
    const sources = memories.filter((m) => m.type === MemoryType.PATTERN).map((m) => m.source);

    assertEquals(sources[0], `pattern:${both.id}`, "the both-signals pattern must rank first");
    assertEquals(sources[1], `pattern:${vectorOnly.id}`, "the vector-only pattern must rank second");
    assertEquals(sources[2], `pattern:${keywordOnly.id}`, "the keyword-only pattern must rank third");
  } finally {
    await cleanup();
  }
});

Deno.test("keyword floor: retrieval returns keyword results when embeddings are unavailable", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.createProjectMemory({
      portal: "floor-portal",
      overview: "A project for floor testing.",
      patterns: [
        { name: "Repository pattern for data access", description: "Data access via repositories.", examples: [] },
      ],
      decisions: [],
      references: [],
    });
    const embedding = kindStubEmbedding([]);
    const sessionMemory = new SessionMemoryService(bank, embedding);

    const memories = await sessionMemory.lookupMemories("repository", undefined);

    assertEquals(memories.length >= 1, true, "keyword floor must still return results");
    assertEquals(memories.every((m) => m.relevance > 0), true);
  } finally {
    await cleanup();
  }
});

Deno.test("learning-type hybrid candidates are filtered to APPROVED (PENDING excluded regardless of recency)", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    const pending: ILearning = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Pending unverified insight",
      description: "Never reviewed.",
      status: MemoryStatus.PENDING,
    });
    const approved: ILearning = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Approved insight",
      description: "Reviewed and approved.",
      status: MemoryStatus.APPROVED,
    });
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(pending);
    await bank.addGlobalLearning(approved);

    const embedding = kindStubEmbedding([
      { id: pending.id, kind: MemoryType.LEARNING, similarity: 0.99 },
      { id: approved.id, kind: MemoryType.LEARNING, similarity: 0.6 },
    ]);
    const sessionMemory = new SessionMemoryService(bank, embedding);

    const memories = await sessionMemory.lookupMemories("insight", undefined);

    assertEquals(memories.length, 1);
    assertEquals(memories[0].source, `learning:${approved.id}`);
  } finally {
    await cleanup();
  }
});

Deno.test("GAP-10: a promoted global learning with zero embedding match still surfaces via the keyword signal", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    const approved: ILearning = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Rate limiter resets on full restart",
      description: "Process-lifetime state needs explicit invalidation hooks.",
      status: MemoryStatus.APPROVED,
    });
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(approved);

    const embedding = kindStubEmbedding([]); // no vector signal at all
    const sessionMemory = new SessionMemoryService(bank, embedding);

    const memories = await sessionMemory.lookupMemories("rate limiter", undefined);

    const learningItem = memories.find((m) => m.source === `learning:${approved.id}`);
    assertEquals(learningItem !== undefined, true, "the keyword-only global learning must surface");
    assertEquals(learningItem!.type, MemoryType.LEARNING);
  } finally {
    await cleanup();
  }
});

Deno.test("GAP-10: a global learning matched by both signals is not double-counted", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    const both: ILearning = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Backoff jitter prevents thundering herd",
      description: "Backoff jitter prevents thundering herd on retry storms.",
      status: MemoryStatus.APPROVED,
    });
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(both);

    const embedding = kindStubEmbedding([{ id: both.id, kind: MemoryType.LEARNING, similarity: 0.8 }]);
    const sessionMemory = new SessionMemoryService(bank, embedding);

    const memories = await sessionMemory.lookupMemories("thundering herd", undefined);
    const matches = memories.filter((m) => m.source === `learning:${both.id}`);

    assertEquals(matches.length, 1, "a learning surfaced by both signals must appear exactly once");
  } finally {
    await cleanup();
  }
});

Deno.test("embedded overviews and executions surface with their MemoryType", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    const traceId = "55555555-5555-4555-8555-555555555555";
    const embedding = kindStubEmbedding([
      { id: "hybrid-portal:overview", kind: MemoryType.PROJECT, similarity: 0.9 },
      { id: traceId, kind: MemoryType.EXECUTION, similarity: 0.85 },
    ]);
    const sessionMemory = new SessionMemoryService(bank, embedding);

    const memories = await sessionMemory.lookupMemories("anything", undefined);

    const overviewItem = memories.find((m) => m.type === MemoryType.PROJECT);
    const executionItem = memories.find((m) => m.type === MemoryType.EXECUTION);
    assertEquals(overviewItem !== undefined, true, "overview must surface as a PROJECT memory");
    assertEquals(executionItem !== undefined, true, "execution must surface as an EXECUTION memory");
    assertEquals(executionItem!.source, `execution:${traceId}`);
  } finally {
    await cleanup();
  }
});
