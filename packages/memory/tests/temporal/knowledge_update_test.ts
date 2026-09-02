/**
 * @module KnowledgeUpdateTest
 * @path packages/memory/tests/temporal/knowledge_update_test.ts
 * @description End-to-end temporal retrieval through SessionMemoryService + MemoryBankService: after a SUPERSEDE, retrieval returns the new fact and drops the superseded one even though its stale embedding persists in the status-blind index; a PENDING insight (the saveInsight path) never outranks an APPROVED learning; candidates with no verifiable bank record are excluded.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import { ConfidenceLevel, LearningCategory } from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { MemoryBankService, SessionMemoryService } from "@exaix/memory";
import type { IMemoryEmbeddingService } from "@exaix/core/types";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import { castAny, createSampleLearning, initTestDbService } from "@exaix/testing";

const MS_PER_DAY = 86_400_000;

/** File-backed-style stub: embedLearning writes into the index, searchByEmbedding reads it — mirrors the real service's data flow so saveInsight-created PENDING entries surface in searches like they do in production. */
function indexingEmbeddingService(
  initial: Record<string, number> = {},
  embedSimilarity = 0.99,
): IMemoryEmbeddingService {
  const index = new Map<string, number>(Object.entries(initial));
  return castAny<IMemoryEmbeddingService>({
    embedLearning: (learning: ILearning) => {
      index.set(learning.id, embedSimilarity);
      return Promise.resolve();
    },
    searchByEmbedding: () =>
      Promise.resolve(
        [...index.entries()].map(([id, similarity]) => ({ id, title: id, summary: id, similarity })),
      ),
  });
}

/** Static stub: fixed similarity per id regardless of query — models a stale/legacy index. */
function staticEmbeddingService(similarities: Record<string, number>): IMemoryEmbeddingService {
  return castAny<IMemoryEmbeddingService>({
    embedLearning: () => Promise.resolve(),
    searchByEmbedding: () =>
      Promise.resolve(
        Object.entries(similarities).map(([id, similarity]) => ({ id, title: id, summary: id, similarity })),
      ),
  });
}

function agedIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

Deno.test("after a SUPERSEDE, retrieval returns the new fact, not the old (stale embedding excluded via bank status)", async () => {
  const { config, cleanup } = await initTestDbService();
  const now = new Date();
  const oldLearning = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Use callbacks for async flows",
    description: "Async flows are coordinated with nested callbacks.",
    status: MemoryStatus.APPROVED,
    created_at: agedIso(now, 400),
  });
  const newLearning = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Prefer async/await over callbacks",
    description: "Async flows use async/await instead of nested callbacks.",
    status: MemoryStatus.APPROVED,
    created_at: new Date().toISOString(),
  });
  // No embedding service on the bank: adds and supersede run without dedup/contradiction interference.
  const bank = new MemoryBankService(config);
  try {
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(oldLearning);
    await bank.supersedeLearning(oldLearning.id, newLearning, "knowledge update");

    // Both embeddings persist in the status-blind index (supersede does not delete embeddings) —
    // the temporal scorer must drop the superseded one via the bank's own status, not the index.
    const sessionMemory = new SessionMemoryService(
      bank,
      staticEmbeddingService({ [oldLearning.id]: 0.9, [newLearning.id]: 0.9 }),
    );

    const memories = await sessionMemory.lookupMemories("async flows");
    assertEquals(memories.length, 1);
    assertEquals(memories[0].source, `learning:${newLearning.id}`);
    assertEquals(memories.some((m) => m.source === `learning:${oldLearning.id}`), false);
    assertEquals(memories[0].relevance > 0, true);
  } finally {
    await cleanup();
  }
});

Deno.test("a saveInsight insight enters tiered memory only - no global write, no embedding (GAP-1 contract)", async () => {
  const { config, cleanup } = await initTestDbService();
  const now = new Date();
  const approvedOld = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Wrap flaky calls in retries",
    description: "Use exponential backoff retries for flaky network calls.",
    status: MemoryStatus.APPROVED,
    created_at: agedIso(now, 365),
  });
  const bank = new MemoryBankService(config);
  try {
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(approvedOld);

    const embedding = indexingEmbeddingService({ [approvedOld.id]: 0.6 });
    const sessionMemory = new SessionMemoryService(bank, embedding);

    // saveInsight is tiered-only: no global-bank write, no embedding.
    const result = await sessionMemory.saveInsight({
      title: "Prefer short test names",
      description: "Test names should describe behaviour in one short sentence.",
      category: LearningCategory.PATTERN,
      tags: ["testing"],
      confidence: ConfidenceLevel.MEDIUM,
    });
    assertEquals(result.success, true);

    const globalAfter = await bank.getGlobalMemory();
    assertEquals(
      globalAfter?.learnings.filter((l) => l.title === "Prefer short test names").length ?? 0,
      0,
      "saveInsight must not write to the global bank",
    );

    const memories = await sessionMemory.lookupMemories("retries backoff");
    assertEquals(memories.length, 1);
    assertEquals(memories[0].source, `learning:${approvedOld.id}`);
  } finally {
    await cleanup();
  }
});

Deno.test("an embedding candidate with no verifiable bank record is excluded (status-blind index defense)", async () => {
  const { config, cleanup } = await initTestDbService();
  const approved = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Cache embedding lookups",
    description: "Embedding lookups are cached on disk to avoid duplicate provider calls.",
    status: MemoryStatus.APPROVED,
  });
  const bank = new MemoryBankService(config);
  try {
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(approved);

    const ghostId = crypto.randomUUID();
    const sessionMemory = new SessionMemoryService(
      bank,
      staticEmbeddingService({ [ghostId]: 0.99, [approved.id]: 0.5 }),
    );

    const memories = await sessionMemory.lookupMemories("embedding cache");
    assertEquals(memories.length, 1);
    assertEquals(memories[0].source, `learning:${approved.id}`);
  } finally {
    await cleanup();
  }
});

Deno.test("a fresh APPROVED learning outranks an older APPROVED learning on the same topic end-to-end", async () => {
  const { config, cleanup } = await initTestDbService();
  const now = new Date();
  const older = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Retry with fixed delays",
    description: "Retry failed requests with fixed one-second delays.",
    status: MemoryStatus.APPROVED,
    created_at: agedIso(now, 300),
  });
  const fresher = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Retry with exponential backoff",
    description: "Retry failed requests with exponential backoff instead of fixed delays.",
    status: MemoryStatus.APPROVED,
    created_at: new Date().toISOString(),
  });
  const bank = new MemoryBankService(config);
  try {
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(older);
    await bank.addGlobalLearning(fresher);

    const sessionMemory = new SessionMemoryService(
      bank,
      staticEmbeddingService({ [older.id]: 0.9, [fresher.id]: 0.9 }),
    );

    const memories = await sessionMemory.lookupMemories("retry strategy");
    assertEquals(memories.length, 2);
    assertEquals(memories[0].source, `learning:${fresher.id}`);
    assertEquals(memories[1].source, `learning:${older.id}`);
    assertEquals(memories[0].relevance > memories[1].relevance, true);
  } finally {
    await cleanup();
  }
});
