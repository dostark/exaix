/**
 * @module ReflectionDaemonWiringTest
 * @path packages/memory/tests/reflection/reflection_daemon_wiring_test.ts
 * @description GAP-6 reachability proof: constructs the real `initializeMemoryAutoApprovalMaintenance` maintenance loop with a real mock-provider `MemoryReflectionService` and asserts a synthesized learning is observable in Memory/Pending and a reflection cycle event is journalled after one interval tick — not a package-unit test.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import type { IModelProvider } from "@exaix/ai";
import type { IMemoryBankService, IMemoryEmbeddingService, INotificationService } from "@exaix/core/types";
import type { ISkillsService } from "@exaix/core/types";
import { DomainEventType } from "@exaix/core/events";
import { MemoryStatus } from "@exaix/core/status";
import { EventLogger } from "@exaix/core/logger";
import type { MemoryAutoApprovalService } from "@exaix/memory";
import {
  initializeMemoryAutoApprovalMaintenance,
  MemoryBankService,
  MemoryExtractorService,
  MemoryReflectionService,
} from "@exaix/memory";
import { castAny, createSampleLearning, initTestDbService } from "@exaix/testing";

const POLICY_INSTRUCTIONS = "Retain non-derivable knowledge.";

class StubProvider implements IModelProvider {
  id = "reflection-daemon-test";
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("the real maintenance loop invokes reflection; a synthesized learning is observable after one tick", async () => {
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
    const logger = new EventLogger({ db });
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
      skillsService: castAny<Pick<ISkillsService, "getSkill">>({
        getSkill: (skillId: string) => Promise.resolve({ skill_id: skillId, instructions: POLICY_INSTRUCTIONS }),
      }),
      memoryBank: bank,
      embeddingService: castAny<IMemoryEmbeddingService>({ searchByEmbedding: () => Promise.resolve([]) }),
      proposalWriter: extractor,
      logger,
    });

    const maintenance = await initializeMemoryAutoApprovalMaintenance({
      notificationService: castAny<Pick<INotificationService, "notifyPendingDigestIfNeeded">>({
        notifyPendingDigestIfNeeded: () => Promise.resolve(false),
      }),
      memoryExtractor: extractor,
      autoApprovalService: castAny<Pick<MemoryAutoApprovalService, "runApprovalCycle">>({
        runApprovalCycle: () =>
          Promise.resolve({ runAt: new Date().toISOString(), promoted: [], skipped: [], dryRun: false }),
      }),
      logger,
      intervalMs: 10,
      reflectionService: reflection,
    });

    await delay(120);
    maintenance.stop();

    // The synthesized learning is observable in Memory/Pending after one tick.
    const pending = await extractor.listPending();
    assertEquals(pending.length, 1);
    assertEquals(pending[0].learning.title, "Retry policy for flaky integrations");

    // The reflection cycle is journalled with its counts.
    const events = db.getActivitiesByActionType(DomainEventType.MemoryReflectionCycleCompleted);
    assertEquals(events.length >= 1, true);
    const payload = JSON.parse(events[0].payload);
    assertEquals(payload.synthesised_count, 1);
    assertEquals(payload.merged_count, 0);
    assertEquals(payload.pruned_count, 0);
  } finally {
    await cleanup();
  }
});
