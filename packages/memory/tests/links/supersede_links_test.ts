/**
 * @module SupersedeLinksTest
 * @path packages/memory/tests/links/supersede_links_test.ts
 * @description Verifies that `supersedeLearning` writes matching `supersedes`/`superseded_by` typed link entries on both sides at supersession time, regardless of the caller: direct calls, the contradiction-resolution path, the semantic-dedup merge path, and the reflection merge.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import type { ILearningContradictionResolver, IMemoryBankService, IMemoryEmbeddingService } from "@exaix/core/types";
import type { ISkillsService } from "@exaix/core/types";
import { MemoryOperation } from "@exaix/core";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import { MemoryStatus } from "@exaix/core/status";
import { MemoryBankService, MemoryExtractorService, MemoryReflectionService } from "@exaix/memory";
import { castAny, createSampleLearning, initTestDbService } from "@exaix/testing";

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

Deno.test("supersedeLearning writes matching supersedes/superseded_by links on both sides", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    const oldLearning = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Old guidance",
      description: "Outdated guidance.",
      status: MemoryStatus.APPROVED,
    });
    const newLearning = createSampleLearning({
      id: crypto.randomUUID(),
      title: "New guidance",
      description: "Corrected guidance.",
      status: MemoryStatus.APPROVED,
    });
    await bank.addGlobalLearning(oldLearning);

    await bank.supersedeLearning(oldLearning.id, newLearning, "test supersede");

    const learnings = (await bank.getGlobalMemory())!.learnings;
    const storedOld = learnings.find((l) => l.id === oldLearning.id)!;
    const storedNew = learnings.find((l) => l.id === newLearning.id)!;
    assertEquals(
      storedNew.links?.some((link) => link.target_id === oldLearning.id && link.type === "supersedes"),
      true,
    );
    assertEquals(
      storedOld.links?.some((link) => link.target_id === newLearning.id && link.type === "superseded_by"),
      true,
    );
    assertEquals(storedOld.status, MemoryStatus.SUPERSEDED);
    assertEquals(storedOld.superseded_by, newLearning.id);
  } finally {
    await cleanup();
  }
});

Deno.test("the contradiction path produces the same supersession links", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const existing = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Use retries with backoff",
      description: "Wrap flaky calls in backoff.",
      status: MemoryStatus.APPROVED,
    });
    const incoming = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Retries contradict earlier guidance",
      description: "Do not retry; fail fast instead.",
      status: MemoryStatus.APPROVED,
    });
    const resolver = castAny<ILearningContradictionResolver>({
      resolve: (_incoming: ILearning, candidates: ILearning[]) => {
        if (candidates.length === 0) {
          return Promise.resolve({ operation: MemoryOperation.ADD, reason: "no candidates" });
        }
        return Promise.resolve({
          operation: MemoryOperation.SUPERSEDE,
          candidateId: candidates[0].id,
          reason: "test contradiction",
        });
      },
    });
    const bank = new MemoryBankService(config, undefined, { contradictionResolver: resolver });
    bank.setEmbeddingService(
      embedding({ "Retries contradict earlier guidance": [{ id: existing.id, similarity: 0.8 }] }),
    );
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(existing);

    await bank.addGlobalLearning(incoming);

    const learnings = (await bank.getGlobalMemory())!.learnings;
    const storedIncoming = learnings.find((l) => l.id === incoming.id)!;
    const storedExisting = learnings.find((l) => l.id === existing.id)!;
    assertEquals(
      storedIncoming.links?.some((link) => link.target_id === existing.id && link.type === "supersedes"),
      true,
    );
    assertEquals(
      storedExisting.links?.some((link) => link.target_id === incoming.id && link.type === "superseded_by"),
      true,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("the semantic-dedup merge path produces the same supersession links", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    const existing = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Use retries with backoff",
      description: "Wrap flaky calls in backoff.",
      status: MemoryStatus.APPROVED,
    });
    const nearDuplicate = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Retry flaky network calls",
      description: "Back off exponentially on flaky calls.",
      status: MemoryStatus.APPROVED,
    });
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(existing);
    // The dedup matcher queries with the incoming text; make the existing learning its strongest match.
    bank.setEmbeddingService(embedding({ "Retry flaky network calls": [{ id: existing.id, similarity: 0.97 }] }));

    await bank.addGlobalLearning(nearDuplicate);

    const learnings = (await bank.getGlobalMemory())!.learnings;
    const storedExisting = learnings.find((l) => l.id === existing.id)!;
    const merged = learnings.find((l) => l.supersedes === existing.id)!;
    assertEquals(merged.links?.some((link) => link.target_id === existing.id && link.type === "supersedes"), true);
    assertEquals(
      storedExisting.links?.some((link) => link.target_id === merged.id && link.type === "superseded_by"),
      true,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("the reflection merge path produces the same supersession links on all retired sources", async () => {
  const { config, db, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    const stronger = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Retry flaky network calls",
      description: "Use exponential backoff for flaky calls.",
      quality_score: 0.9,
      status: MemoryStatus.APPROVED,
    });
    const weaker = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Backoff for integrations",
      description: "Integrations need retry with backoff.",
      quality_score: 0.4,
      status: MemoryStatus.APPROVED,
    });
    await bank.addGlobalLearning(stronger);
    await bank.addGlobalLearning(weaker);
    const extractor = new MemoryExtractorService(config, db, castAny<IMemoryBankService>(bank));
    const reflection = new MemoryReflectionService({
      provider: new StubProvider(JSON.stringify({ actions: [] })),
      skillsService: castAny<Pick<ISkillsService, "getSkill">>({
        getSkill: (skillId: string) => Promise.resolve({ skill_id: skillId, instructions: "policy" }),
      }),
      memoryBank: bank,
      embeddingService: embedding({ "Retry flaky network calls": [{ id: weaker.id, similarity: 0.95 }] }),
      proposalWriter: extractor,
    });

    const result = await reflection.runReflectionCycle();
    assertEquals(result.merged_count, 1);

    const learnings = (await bank.getGlobalMemory())!.learnings;
    const merged = learnings.find((l) => l.supersedes === weaker.id)!;
    assertEquals(merged.links?.some((link) => link.target_id === weaker.id && link.type === "supersedes"), true);
    assertEquals(
      learnings.find((l) => l.id === weaker.id)!.links?.some((link) =>
        link.target_id === merged.id && link.type === "superseded_by"
      ),
      true,
    );
    assertEquals(
      learnings.find((l) => l.id === stronger.id)!.links?.some((link) =>
        link.target_id === merged.id && link.type === "superseded_by"
      ),
      true,
    );
  } finally {
    await cleanup();
  }
});

class StubProvider {
  id = "supersede-links-test";
  constructor(private content: string) {}
  generate() {
    return Promise.resolve({
      content: this.content,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: "mock-memory",
      provider: "mock",
      cost_usd: 0,
    });
  }
}
