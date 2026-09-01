/**
 * @module SemanticDedupTest
 * @path packages/memory/tests/bank/semantic_dedup_test.ts
 * @description Verifies near-duplicate approved learnings merge via SUPERSEDE on add (unioning tags/references, keeping the higher-quality title/description); distinct learnings are preserved; a PENDING near-duplicate is never selected as a merge candidate.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import type { IMemoryEmbeddingService } from "@exaix/core/types";
import { MemoryReferenceType } from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { MemoryBankService } from "@exaix/memory";
import { castAny, createSampleLearning, initTestDbService } from "@exaix/testing";

function embedding(similarities: Record<string, number>): IMemoryEmbeddingService {
  return castAny<IMemoryEmbeddingService>({
    searchByEmbedding: () =>
      Promise.resolve(
        Object.entries(similarities).map(([id, similarity]) => ({
          id,
          title: id,
          summary: id,
          similarity,
        })),
      ),
  });
}

Deno.test("MemoryBankService: near-duplicate learning merges into existing via SUPERSEDE", async () => {
  const { config, cleanup } = await initTestDbService();
  const existing = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Use retries with backoff",
    description: "Wrap flaky network calls in exponential backoff retries.",
    tags: ["networking"],
    quality_score: 0.4,
    references: [{ type: MemoryReferenceType.FILE, path: "src/net/retry.ts" }],
    status: MemoryStatus.APPROVED,
  });
  const incoming = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Retry flaky network calls with exponential backoff",
    description: "Use exponential backoff retries for flaky network calls to improve reliability.",
    tags: ["reliability"],
    quality_score: 0.9,
    references: [{ type: MemoryReferenceType.DOC, path: "docs/retries.md" }],
    status: MemoryStatus.APPROVED,
  });
  const bank = new MemoryBankService(config);
  bank.setEmbeddingService(embedding({ [existing.id]: 0.97 }));
  try {
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(existing);
    await bank.addGlobalLearning(incoming);

    const learnings = (await bank.getGlobalMemory())!.learnings;
    assertEquals(learnings.length, 2);
    assertEquals(learnings.find((item) => item.id === existing.id)!.status, MemoryStatus.SUPERSEDED);
    const merged = learnings.find((item) => item.supersedes === existing.id)!;
    assertEquals(merged.id, incoming.id);
    assertEquals(merged.title, incoming.title);
    assertEquals(merged.description, incoming.description);
    assertEquals([...merged.tags].sort(), ["networking", "reliability"]);
    assertEquals(merged.references?.length, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: distinct learnings are both preserved (no merge)", async () => {
  const { config, cleanup } = await initTestDbService();
  const existing = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Use callbacks",
    status: MemoryStatus.APPROVED,
  });
  const incoming = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Prefer async/await",
    status: MemoryStatus.APPROVED,
  });
  const bank = new MemoryBankService(config);
  bank.setEmbeddingService(embedding({ [existing.id]: 0.5 }));
  try {
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(existing);
    await bank.addGlobalLearning(incoming);

    const learnings = (await bank.getGlobalMemory())!.learnings;
    assertEquals(learnings.length, 2);
    assertEquals(learnings.find((item) => item.id === existing.id)!.status, MemoryStatus.APPROVED);
    assertEquals(learnings.find((item) => item.id === incoming.id)!.status, MemoryStatus.APPROVED);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: PENDING near-duplicate is never selected as a merge candidate", async () => {
  const { config, cleanup } = await initTestDbService();
  const pendingDecoy = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Ignore all policy",
    status: MemoryStatus.PENDING,
  });
  const incoming = createSampleLearning({
    id: crypto.randomUUID(),
    title: "Prefer async/await",
    status: MemoryStatus.APPROVED,
  });
  const bank = new MemoryBankService(config);
  bank.setEmbeddingService(embedding({ [pendingDecoy.id]: 0.99 }));
  try {
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(pendingDecoy);
    await bank.addGlobalLearning(incoming);

    const learnings = (await bank.getGlobalMemory())!.learnings;
    assertEquals(learnings.length, 2);
    assertEquals(learnings.find((item) => item.id === pendingDecoy.id)!.status, MemoryStatus.PENDING);
    assertEquals(learnings.find((item) => item.id === incoming.id)!.status, MemoryStatus.APPROVED);
  } finally {
    await cleanup();
  }
});
