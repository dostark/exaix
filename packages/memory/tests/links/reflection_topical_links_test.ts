/**
 * @module ReflectionTopicalLinksTest
 * @path packages/memory/tests/links/reflection_topical_links_test.ts
 * @description Verifies that the reflection synthesis pass writes `topical` links on both sides for learnings it compares above the dedup similarity threshold without merging outright (synthesis takes precedence for the cycle), that pairs below the threshold stay unlinked, and that links are written idempotently.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import type { IModelProvider } from "@exaix/ai";
import type { IMemoryBankService, IMemoryEmbeddingService } from "@exaix/core/types";
import type { IReflectionSkills } from "@exaix/memory/reflection/memory_reflection_service.ts";
import { MemoryStatus } from "@exaix/core/status";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
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

function skillsService(): IReflectionSkills {
  return castAny<IReflectionSkills>({
    recordSubmission: () => Promise.resolve(),
    currentConfigGeneration: () => "static",
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

interface ISynthesisScenario {
  bank: MemoryBankService;
  a: ILearning;
  b: ILearning;
  reflection: MemoryReflectionService;
}

/**
 * Runs `body` with two approved learnings, a provider that synthesises them, and an embedding service that
 * reports `similarity` between them.
 */
async function withSynthesisScenario(
  similarity: number,
  body: (scenario: ISynthesisScenario) => Promise<void>,
): Promise<void> {
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
      embeddingService: embedding({ "Retry flaky network calls": [{ id: b.id, similarity }] }),
      proposalWriter: extractor,
    });
    await body({ bank, a, b, reflection });
  } finally {
    await cleanup();
  }
}

const hasTopicalLink = (learning: ILearning, targetId: string): boolean =>
  learning.links?.some((link) => link.target_id === targetId && link.type === "topical") ?? false;

Deno.test("synthesis of a pair compared above the dedup threshold writes topical links on both sides instead of merging", async () => {
  await withSynthesisScenario(0.95, async ({ bank, a, b, reflection }) => {
    const result = await reflection.runReflectionCycle();

    assertEquals(result.synthesised_count, 1);
    assertEquals(result.merged_count, 0, "a synthesis-covered pair is not merged outright");
    const learnings = (await bank.getGlobalMemory())!.learnings;
    assertEquals(hasTopicalLink(learnings.find((l) => l.id === a.id)!, b.id), true);
    assertEquals(hasTopicalLink(learnings.find((l) => l.id === b.id)!, a.id), true);
    assertEquals(
      learnings.find((l) => l.id === a.id)!.status,
      MemoryStatus.APPROVED,
      "sources stay APPROVED until the synthesis is approved",
    );
  });
});

Deno.test("pairs compared below the dedup threshold stay unlinked", async () => {
  await withSynthesisScenario(0.8, async ({ bank, a, b, reflection }) => {
    const result = await reflection.runReflectionCycle();

    assertEquals(result.synthesised_count, 1);
    const learnings = (await bank.getGlobalMemory())!.learnings;
    assertEquals(learnings.find((l) => l.id === a.id)!.links, undefined);
    assertEquals(learnings.find((l) => l.id === b.id)!.links, undefined);
  });
});

Deno.test("topical links are written idempotently across repeated cycles", async () => {
  await withSynthesisScenario(0.95, async ({ bank, a, b, reflection }) => {
    await reflection.runReflectionCycle();
    await reflection.runReflectionCycle();

    const learnings = (await bank.getGlobalMemory())!.learnings;
    const topicalLinksA = learnings.find((l) => l.id === a.id)!.links?.filter((link) => link.type === "topical") ?? [];
    const topicalLinksB = learnings.find((l) => l.id === b.id)!.links?.filter((link) => link.type === "topical") ?? [];
    assertEquals(topicalLinksA.length, 1, "no duplicate topical links after a second pass");
    assertEquals(topicalLinksB.length, 1);
  });
});
