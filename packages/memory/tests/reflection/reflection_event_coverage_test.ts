/**
 * @module ReflectionEventCoverageTest
 * @path packages/memory/tests/reflection/reflection_event_coverage_test.ts
 * @description Verifies `MemoryReflectionCycleCompleted` is journalled with `synthesised_count`/`merged_count`/`pruned_count` metadata after each pass, that the service class carries the `@visible` tag required by the event-coverage gate, and that merge/prune/synthesis mutations are individually journalled through the bank's own events.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import type { IModelProvider } from "@exaix/ai";
import type { IMemoryBankService, IMemoryEmbeddingService } from "@exaix/core/types";
import type { ISkillsService } from "@exaix/core/types";
import { DomainEventType } from "@exaix/core/events";
import { MemoryStatus } from "@exaix/core/status";
import { EventLogger } from "@exaix/core/logger";
import { MemoryBankService, MemoryExtractorService, MemoryReflectionService } from "@exaix/memory";
import { castAny, createSampleLearning, initTestDbService } from "@exaix/testing";

const SERVICE_SOURCE_URL = new URL("../../src/reflection/memory_reflection_service.ts", import.meta.url);

class StubProvider implements IModelProvider {
  id = "reflection-events-test";
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
        skillId === "memory-extraction-content-policy" ? { skill_id: skillId, instructions: "policy" } : null,
      ),
  });
}

function embedding(similar: Array<{ id: string; similarity: number }>): IMemoryEmbeddingService {
  return castAny<IMemoryEmbeddingService>({
    searchByEmbedding: () =>
      Promise.resolve(
        similar.map(({ id, similarity }) => ({ id, title: id, summary: id, similarity, kind: "learning" })),
      ),
    getEmbedding: () => Promise.resolve(null),
    deleteEmbedding: () => Promise.resolve(),
    getStats: () => Promise.resolve({ total: 0, generated_at: "" }),
  });
}

Deno.test("the MemoryReflectionService class is @visible-tagged", async () => {
  const source = await Deno.readTextFile(SERVICE_SOURCE_URL);
  assertEquals(
    source.includes("@visible"),
    true,
    "the reflection service mutates the store unattended and must be @visible",
  );
});

Deno.test("a completed cycle journals MemoryReflectionCycleCompleted with synthesised/merged/pruned counts", async () => {
  const { config, db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const bank = new MemoryBankService(config, logger);
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
    const lowValue = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Import structure fact",
      description: "src/a.ts imports src/b.ts.",
      status: MemoryStatus.APPROVED,
    });
    await bank.addGlobalLearning(stronger);
    await bank.addGlobalLearning(weaker);
    await bank.addGlobalLearning(lowValue);
    const extractor = new MemoryExtractorService(config, db, castAny<IMemoryBankService>(bank), logger);
    const reflection = new MemoryReflectionService({
      provider: new StubProvider(
        JSON.stringify({ actions: [{ action: "prune", target_id: lowValue.id, reason: "Restates structural facts" }] }),
      ),
      skillsService: skillsService(),
      memoryBank: bank,
      embeddingService: embedding([{ id: weaker.id, similarity: 0.95 }]),
      proposalWriter: extractor,
      logger,
    });

    await reflection.runReflectionCycle();
    await db.waitForFlush();

    const completed = db.getActivitiesByActionType(DomainEventType.MemoryReflectionCycleCompleted);
    assertEquals(completed.length, 1);
    const payload = JSON.parse(completed[0].payload);
    assertEquals(payload.synthesised_count, 0);
    assertEquals(payload.merged_count, 1);
    assertEquals(payload.pruned_count, 1);

    // The mutations themselves are journalled through the bank's per-mutation events.
    const deletions = db.getActivitiesByActionType(DomainEventType.MemoryLearningDeleted);
    assertEquals(deletions.length, 1);
    assertEquals(JSON.parse(deletions[0].payload).learning_id, lowValue.id);
  } finally {
    await cleanup();
  }
});
