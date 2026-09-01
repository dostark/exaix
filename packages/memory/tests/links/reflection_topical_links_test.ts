/**
 * @module ReflectionTopicalLinksTest
 * @path packages/memory/tests/links/reflection_topical_links_test.ts
 * @description Verifies that the reflection synthesis pass writes `topical` links on both sides for learnings it compares above the dedup similarity threshold without merging outright (synthesis takes precedence for the cycle), that pairs below the threshold stay unlinked, and that links are written idempotently.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import type { IModelProvider } from "@exaix/ai";
import type { IMemoryBankService, IMemoryEmbeddingService } from "@exaix/core/types";
import type { ISkillsService } from "@exaix/core/types";
import { MemoryStatus } from "@exaix/core/status";
import { MemoryBankService, MemoryExtractorService, MemoryReflectionService } from "@exaix/memory";
import { castAny, createSampleLearning, initTestDbService } from "@exaix/testing";

const POLICY_INSTRUCTIONS = "Retain non-derivable knowledge.";

class StubProvider implements IModelProvider {
  id = "reflection-topical-test";
  constructor(private content: string) {}
  generate() {
    return Promise.resolve({
      content: this.content,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      model: "mock-memory",
      provider: "mock",
      cost_usd: 0.002,
    });
  }
}

function skillsService(): Pick<ISkillsService, "getSkill"> {
  return castAny<Pick<ISkillsService, "getSkill">>({
    getSkill: (skillId: string) =>
      Promise.resolve(
        skillId === "memory-extraction-content-policy"
          ? { skill_id: skillId, instructions: POLICY_INSTRUCTIONS }
          : null,
      ),
  });
}

function embedding(similar: Record<string, Array<{ id: string; similarity: number }>>): IMemoryEmbeddingService {
  return castAny<IMemoryEmbeddingService>({
    searchByEmbedding: (query: string) => {
      const found = Object.entries(similar).find(([title]) => query.includes(title));
      return Promise.resolve(
        (found?.[1] ?? []).map(({ id, similarity }) => ({ id, title: id, summary: id, similarity, kind: "learning" })),
      );
    },
    getEmbedding: () => Promise.resolve(null),
    deleteEmbedding: () => Promise.resolve(),
    getStats: () => Promise.resolve({ total: 0, generated_at: "" }),
  });
}

Deno.test("synthesis of a pair compared above the dedup threshold writes topical links on both sides instead of merging", async () => {
  const { config, db, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    const a = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Retry flaky network calls",
      description: "Use exponential backoff for flaky calls.",
      status: MemoryStatus.APPROVED,
    });
    const b = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Backoff for integrations",
      description: "Integrations need retry with backoff.",
      status: MemoryStatus.APPROVED,
    });
    await bank.addGlobalLearning(a);
    await bank.addGlobalLearning(b);
    const extractor = new MemoryExtractorService(config, db, castAny<IMemoryBankService>(bank));
    const reflection = new MemoryReflectionService({
      provider: new StubProvider(JSON.stringify({
        actions: [{
          action: "synthesise",
          source_ids: [a.id, b.id],
          title: "Retry policy for flaky integrations",
          description: "Wrap flaky integration calls in exponential backoff retries with jitter.",
          category: "insight",
          tags: ["reliability"],
          quality_score: 0.85,
        }],
      })),
      skillsService: skillsService(),
      memoryBank: bank,
      embeddingService: embedding({ "Retry flaky network calls": [{ id: b.id, similarity: 0.95 }] }),
      proposalWriter: extractor,
    });

    const result = await reflection.runReflectionCycle();

    assertEquals(result.synthesised_count, 1);
    assertEquals(result.merged_count, 0, "a synthesis-covered pair is not merged outright");
    const learnings = (await bank.getGlobalMemory())!.learnings;
    assertEquals(
      learnings.find((l) => l.id === a.id)!.links?.some((link) => link.target_id === b.id && link.type === "topical"),
      true,
    );
    assertEquals(
      learnings.find((l) => l.id === b.id)!.links?.some((link) => link.target_id === a.id && link.type === "topical"),
      true,
    );
    assertEquals(
      learnings.find((l) => l.id === a.id)!.status,
      MemoryStatus.APPROVED,
      "sources stay APPROVED until the synthesis is approved",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("pairs compared below the dedup threshold stay unlinked", async () => {
  const { config, db, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    const a = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Retry flaky network calls",
      description: "Use exponential backoff for flaky calls.",
      status: MemoryStatus.APPROVED,
    });
    const b = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Backoff for integrations",
      description: "Integrations need retry with backoff.",
      status: MemoryStatus.APPROVED,
    });
    await bank.addGlobalLearning(a);
    await bank.addGlobalLearning(b);
    const extractor = new MemoryExtractorService(config, db, castAny<IMemoryBankService>(bank));
    const reflection = new MemoryReflectionService({
      provider: new StubProvider(JSON.stringify({
        actions: [{
          action: "synthesise",
          source_ids: [a.id, b.id],
          title: "Retry policy for flaky integrations",
          description: "Wrap flaky integration calls in exponential backoff retries with jitter.",
          category: "insight",
          tags: ["reliability"],
          quality_score: 0.85,
        }],
      })),
      skillsService: skillsService(),
      memoryBank: bank,
      embeddingService: embedding({ "Retry flaky network calls": [{ id: b.id, similarity: 0.8 }] }),
      proposalWriter: extractor,
    });

    const result = await reflection.runReflectionCycle();

    assertEquals(result.synthesised_count, 1);
    const learnings = (await bank.getGlobalMemory())!.learnings;
    assertEquals(learnings.find((l) => l.id === a.id)!.links, undefined);
    assertEquals(learnings.find((l) => l.id === b.id)!.links, undefined);
  } finally {
    await cleanup();
  }
});

Deno.test("topical links are written idempotently across repeated cycles", async () => {
  const { config, db, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    const a = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Retry flaky network calls",
      description: "Use exponential backoff for flaky calls.",
      status: MemoryStatus.APPROVED,
    });
    const b = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Backoff for integrations",
      description: "Integrations need retry with backoff.",
      status: MemoryStatus.APPROVED,
    });
    await bank.addGlobalLearning(a);
    await bank.addGlobalLearning(b);
    const extractor = new MemoryExtractorService(config, db, castAny<IMemoryBankService>(bank));
    const reflection = new MemoryReflectionService({
      provider: new StubProvider(JSON.stringify({
        actions: [{
          action: "synthesise",
          source_ids: [a.id, b.id],
          title: "Retry policy for flaky integrations",
          description: "Wrap flaky integration calls in exponential backoff retries with jitter.",
          category: "insight",
          tags: ["reliability"],
          quality_score: 0.85,
        }],
      })),
      skillsService: skillsService(),
      memoryBank: bank,
      embeddingService: embedding({ "Retry flaky network calls": [{ id: b.id, similarity: 0.95 }] }),
      proposalWriter: extractor,
    });

    await reflection.runReflectionCycle();
    await reflection.runReflectionCycle();

    const learnings = (await bank.getGlobalMemory())!.learnings;
    const topicalLinksA = learnings.find((l) => l.id === a.id)!.links?.filter((link) => link.type === "topical") ?? [];
    const topicalLinksB = learnings.find((l) => l.id === b.id)!.links?.filter((link) => link.type === "topical") ?? [];
    assertEquals(topicalLinksA.length, 1, "no duplicate topical links after a second pass");
    assertEquals(topicalLinksB.length, 1);
  } finally {
    await cleanup();
  }
});
