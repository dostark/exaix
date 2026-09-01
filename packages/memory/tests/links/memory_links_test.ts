/**
 * @module MemoryLinksTest
 * @path packages/memory/tests/links/memory_links_test.ts
 * @description Verifies typed inter-memory links: additive optional `links` load legacy stores unchanged; retrieval can opt into one-hop expansion along links with re-scored, deduplicated results that stay cycle-safe and never surface non-APPROVED targets.
 * @architectural-layer Tests
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import type { IMemoryEmbeddingService } from "@exaix/core/types";
import { MemoryStatus } from "@exaix/core/status";
import { MemoryBankService, SessionMemoryService } from "@exaix/memory";
import { castAny, createSampleLearning, initTestDbService } from "@exaix/testing";

function kindEmbedding(similarities: Record<string, number>): IMemoryEmbeddingService {
  return castAny<IMemoryEmbeddingService>({
    searchByEmbedding: () =>
      Promise.resolve(
        Object.entries(similarities).map(([id, similarity]) => ({
          id,
          title: id,
          summary: id,
          similarity,
          kind: "learning",
        })),
      ),
    getEmbedding: () => Promise.resolve(null),
    deleteEmbedding: () => Promise.resolve(),
    getStats: () => Promise.resolve({ total: 0, generated_at: "" }),
  });
}

Deno.test("learnings without links load unchanged (additive schema)", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    const legacy = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Legacy learning",
      description: "Stored before links existed.",
      status: MemoryStatus.APPROVED,
    });
    await bank.addGlobalLearning(legacy);

    const learnings = (await bank.getGlobalMemory())!.learnings;
    assertEquals(learnings.find((l) => l.id === legacy.id)!.links, undefined);
  } finally {
    await cleanup();
  }
});

Deno.test("one-hop expansion retrieves a linked learning outside the direct top-k, re-scored and deduped", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    const fresh = new Date().toISOString();
    const a = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Use exponential backoff for retries",
      description: "Retry flaky calls with exponential backoff.",
      status: MemoryStatus.APPROVED,
      created_at: fresh,
    });
    const b = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Add jitter to backoff",
      description: "Jitter prevents retry storms.",
      status: MemoryStatus.APPROVED,
      created_at: fresh,
    });
    const c = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Kubernetes deployment strategy",
      description: "Rolling deployments for services.",
      status: MemoryStatus.APPROVED,
      created_at: fresh,
    });
    await bank.addGlobalLearning(a);
    await bank.addGlobalLearning(b);
    await bank.addGlobalLearning(c);
    // Topical links between the two approved learnings (mutual - a cycle).
    await bank.updateLearning(a.id, { links: [{ target_id: b.id, type: "topical" }] });
    await bank.updateLearning(b.id, { links: [{ target_id: a.id, type: "topical" }] });

    const sessionMemory = new SessionMemoryService(bank, kindEmbedding({ [a.id]: 0.9, [b.id]: 0.85, [c.id]: 0.8 }));
    const memories = await sessionMemory.lookupMemories("backoff retries", undefined, { topK: 1, expandLinks: true });

    assertEquals(memories.length, 2, "the linked learning must be expanded beyond the direct top-k");
    assertEquals(memories[0].source, `learning:${a.id}`);
    assertEquals(memories[1].source, `learning:${b.id}`);
    assertAlmostEquals(
      memories[1].relevance,
      0.27,
      0.01,
      "expansion re-scores the linked learning (fused 0.54 x half)",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("expansion is cycle-safe and does not duplicate entries already in the top-k", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    const a = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Use exponential backoff for retries",
      description: "Retry flaky calls with exponential backoff.",
      status: MemoryStatus.APPROVED,
    });
    const b = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Add jitter to backoff",
      description: "Jitter prevents retry storms.",
      status: MemoryStatus.APPROVED,
    });
    await bank.addGlobalLearning(a);
    await bank.addGlobalLearning(b);
    await bank.updateLearning(a.id, {
      links: [{ target_id: b.id, type: "topical" }, { target_id: a.id, type: "topical" }],
    });
    await bank.updateLearning(b.id, { links: [{ target_id: a.id, type: "topical" }] });

    const sessionMemory = new SessionMemoryService(bank, kindEmbedding({ [a.id]: 0.9, [b.id]: 0.85 }));
    const memories = await sessionMemory.lookupMemories("backoff retries", undefined, { topK: 2, expandLinks: true });

    assertEquals(memories.length, 2, "mutual links must not duplicate or loop");
    const sources = memories.map((m) => m.source);
    assertEquals(new Set(sources).size, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("expansion skips non-APPROVED link targets and is opt-in", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    const a = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Use exponential backoff for retries",
      description: "Retry flaky calls with exponential backoff.",
      status: MemoryStatus.APPROVED,
    });
    const deleted = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Deleted guidance",
      description: "Retired guidance.",
      status: MemoryStatus.APPROVED,
    });
    await bank.addGlobalLearning(a);
    await bank.addGlobalLearning(deleted);
    await bank.deleteLearning(deleted.id, "test prune");
    await bank.updateLearning(a.id, { links: [{ target_id: deleted.id, type: "topical" }] });

    const sessionMemory = new SessionMemoryService(bank, kindEmbedding({ [a.id]: 0.9 }));

    // Opt-in: without the flag only the direct top-k is returned.
    const withoutExpansion = await sessionMemory.lookupMemories("backoff retries", undefined, { topK: 1 });
    assertEquals(withoutExpansion.length, 1);

    // With the flag the non-APPROVED target is still never surfaced.
    const memories = await sessionMemory.lookupMemories("backoff retries", undefined, { topK: 1, expandLinks: true });
    assertEquals(memories.length, 1);
    assertEquals(memories[0].source, `learning:${a.id}`);
  } finally {
    await cleanup();
  }
});
