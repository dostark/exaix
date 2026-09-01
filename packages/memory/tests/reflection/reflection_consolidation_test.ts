/**
 * @module ReflectionConsolidationTest
 * @path packages/memory/tests/reflection/reflection_consolidation_test.ts
 * @description Verifies the reflection cycle: related APPROVED learnings synthesise into a higher-order PENDING proposal (sources stay until approval), near-duplicates merge deterministically (Step 4 reuse), low-value entries are soft-deleted reversibly with the record retained, the pass is idempotent, and both input and actions are scoped to APPROVED.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import type { IModelProvider } from "@exaix/ai";
import type { IMemoryBankService, IMemoryEmbeddingService } from "@exaix/core/types";
import type { ISkillsService } from "@exaix/core/types";
import { MemoryStatus } from "@exaix/core/status";
import { LearningCategory } from "@exaix/core";
import { MemoryBankService, MemoryExtractorService, MemoryReflectionService } from "@exaix/memory";
import type { IReflectionCycleResult } from "@exaix/memory";
import { castAny, createSampleLearning, initTestDbService } from "@exaix/testing";

const POLICY_INSTRUCTIONS = "Retain non-derivable knowledge; prune structural restatements.";

class StubProvider implements IModelProvider {
  id = "reflection-test";
  prompt = "";
  constructor(private content: string) {}
  generate(prompt: string) {
    this.prompt = prompt;
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

/** Query-keyed similarity stub: `similar[title]` lists ids that pair with a learning whose title appears in the query. */
function embedding(similar: Record<string, Array<{ id: string; similarity: number }>>): IMemoryEmbeddingService {
  return castAny<IMemoryEmbeddingService>({
    initializeManifest: () => Promise.resolve(),
    embedLearning: () => Promise.resolve(),
    embed: () => Promise.resolve(),
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

function related(id: string, similarity: number) {
  return [{ id, similarity }];
}

Deno.test("related APPROVED learnings synthesise into a higher-order PENDING proposal; sources stay until approval", async () => {
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
          category: LearningCategory.INSIGHT,
          tags: ["reliability"],
          quality_score: 0.85,
        }],
      })),
      skillsService: skillsService(),
      memoryBank: bank,
      embeddingService: embedding({ "Retry flaky network calls": related(b.id, 0.8) }),
      proposalWriter: extractor,
    });

    const result: IReflectionCycleResult = await reflection.runReflectionCycle();
    assertEquals(result.synthesised_count, 1);

    const pending = await extractor.listPending();
    assertEquals(pending.length, 1);
    assertEquals(pending[0].learning.title, "Retry policy for flaky integrations");
    assertEquals(pending[0].learning.source_id?.startsWith("reflection:"), true);
    assertEquals(pending[0].learning.confidence, "high");
    assertEquals(pending[0].status, MemoryStatus.PENDING);

    // Sources stay APPROVED until the synthesis is independently approved.
    const learnings = (await bank.getGlobalMemory())!.learnings;
    assertEquals(learnings.find((l) => l.id === a.id)!.status, MemoryStatus.APPROVED);
    assertEquals(learnings.find((l) => l.id === b.id)!.status, MemoryStatus.APPROVED);
  } finally {
    await cleanup();
  }
});

Deno.test("the reflection pass is idempotent (a second run proposes nothing new)", async () => {
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
    const provider = new StubProvider(JSON.stringify({
      actions: [{
        action: "synthesise",
        source_ids: [a.id, b.id],
        title: "Retry policy for flaky integrations",
        description: "Wrap flaky integration calls in exponential backoff retries with jitter.",
        category: LearningCategory.INSIGHT,
        tags: ["reliability"],
        quality_score: 0.85,
      }],
    }));
    const reflection = new MemoryReflectionService({
      provider,
      skillsService: skillsService(),
      memoryBank: bank,
      embeddingService: embedding({ "Retry flaky network calls": related(b.id, 0.8) }),
      proposalWriter: extractor,
    });

    const first = await reflection.runReflectionCycle();
    assertEquals(first.synthesised_count, 1);
    const second = await reflection.runReflectionCycle();
    assertEquals(second.synthesised_count, 0);
    assertEquals((await extractor.listPending()).length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("low-value entries are soft-deleted reversibly with the record retained for audit", async () => {
  const { config, db, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    const lowValue = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Module import fact",
      description: "File src/a.ts imports src/b.ts.",
      status: MemoryStatus.APPROVED,
    });
    await bank.addGlobalLearning(lowValue);
    const extractor = new MemoryExtractorService(config, db, castAny<IMemoryBankService>(bank));
    const reflection = new MemoryReflectionService({
      provider: new StubProvider(
        JSON.stringify({
          actions: [{
            action: "prune",
            target_id: lowValue.id,
            reason: "Restates import structure derivable from source",
          }],
        }),
      ),
      skillsService: skillsService(),
      memoryBank: bank,
      embeddingService: embedding({}),
      proposalWriter: extractor,
    });

    const result = await reflection.runReflectionCycle();
    assertEquals(result.pruned_count, 1);

    const learnings = (await bank.getGlobalMemory())!.learnings;
    const record = learnings.find((l) => l.id === lowValue.id)!;
    assertEquals(record.status, MemoryStatus.DELETED, "pruned entry must be soft-deleted, never removed");
    assertEquals(learnings.some((l) => l.id === lowValue.id), true, "record retained for audit");

    await bank.updateLearning(lowValue.id, { status: MemoryStatus.APPROVED });
    assertEquals(
      (await bank.getGlobalMemory())!.learnings.find((l) => l.id === lowValue.id)!.status,
      MemoryStatus.APPROVED,
      "prune is reversible",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("near-duplicate APPROVED learnings merge deterministically without an LLM", async () => {
  const { config, db, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    const stronger = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Retry flaky network calls",
      description: "Use exponential backoff for flaky calls.",
      tags: ["reliability"],
      quality_score: 0.9,
      status: MemoryStatus.APPROVED,
    });
    const weaker = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Backoff for integrations",
      description: "Integrations need retry with backoff.",
      tags: ["networking"],
      quality_score: 0.4,
      status: MemoryStatus.APPROVED,
    });
    await bank.addGlobalLearning(stronger);
    await bank.addGlobalLearning(weaker);
    const extractor = new MemoryExtractorService(config, db, castAny<IMemoryBankService>(bank));
    const reflection = new MemoryReflectionService({
      provider: new StubProvider(JSON.stringify({ actions: [] })),
      skillsService: skillsService(),
      memoryBank: bank,
      embeddingService: embedding({ "Retry flaky network calls": related(weaker.id, 0.95) }),
      proposalWriter: extractor,
    });

    const result = await reflection.runReflectionCycle();
    assertEquals(result.merged_count, 1);

    const learnings = (await bank.getGlobalMemory())!.learnings;
    assertEquals(learnings.find((l) => l.id === stronger.id)!.status, MemoryStatus.SUPERSEDED);
    assertEquals(learnings.find((l) => l.id === weaker.id)!.status, MemoryStatus.SUPERSEDED);
    const merged = learnings.find((l) => l.supersedes === weaker.id)!;
    assertEquals(merged.status, MemoryStatus.APPROVED);
    assertEquals([...merged.tags!].sort(), ["networking", "reliability"]);

    const second = await reflection.runReflectionCycle();
    assertEquals(second.merged_count, 0, "merge must reach a fixed point");
  } finally {
    await cleanup();
  }
});

Deno.test("reflection input and actions are scoped to APPROVED (PENDING entries are never touched)", async () => {
  const { config, db, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    const pending = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Pending unreviewed",
      description: "Never reviewed.",
      status: MemoryStatus.PENDING,
    });
    const approved = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Approved insight",
      description: "Reviewed insight.",
      status: MemoryStatus.APPROVED,
    });
    await bank.addGlobalLearning(pending);
    await bank.addGlobalLearning(approved);
    const extractor = new MemoryExtractorService(config, db, castAny<IMemoryBankService>(bank));
    const reflection = new MemoryReflectionService({
      provider: new StubProvider(JSON.stringify({
        actions: [
          { action: "prune", target_id: pending.id, reason: "should be rejected" },
          {
            action: "synthesise",
            source_ids: [pending.id, approved.id],
            title: "Bad synthesis",
            description: "Sources a PENDING entry.",
            category: LearningCategory.INSIGHT,
            tags: [],
            quality_score: 0.9,
          },
        ],
      })),
      skillsService: skillsService(),
      memoryBank: bank,
      embeddingService: embedding({}),
      proposalWriter: extractor,
    });

    const result = await reflection.runReflectionCycle();
    assertEquals(result.pruned_count, 0);
    assertEquals(result.synthesised_count, 0);
    assertEquals(
      (await bank.getGlobalMemory())!.learnings.find((l) => l.id === pending.id)!.status,
      MemoryStatus.PENDING,
    );
  } finally {
    await cleanup();
  }
});
