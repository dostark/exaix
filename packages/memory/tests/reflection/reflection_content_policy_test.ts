/**
 * @module ReflectionContentPolicyTest
 * @path packages/memory/tests/reflection/reflection_content_policy_test.ts
 * @description Verifies the reflection prompt loads the real Step 1 content-curation skill by explicit skill_id and includes it in the synthesis prompt; a low-value entry restating portal-knowledge structural facts is pruned while a genuine architectural-decision entry is retained.
 * @architectural-layer Tests
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { IModelProvider } from "@exaix/ai";
import type { IMemoryBankService, IMemoryEmbeddingService } from "@exaix/core/types";
import type { ISkillsService } from "@exaix/core/types";
import { LearningCategory } from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { MemoryBankService, MemoryExtractorService, MemoryReflectionService } from "@exaix/memory";
import { castAny, createSampleLearning, initTestDbService } from "@exaix/testing";

const SKILL_JSON_URL = new URL(
  "../../../../Memory/Skills/global/memory-extraction-content-policy.json",
  import.meta.url,
);
const SKILL_INSTRUCTIONS: string =
  (JSON.parse(Deno.readTextFileSync(SKILL_JSON_URL)) as { instructions: string }).instructions;

class CapturingProvider implements IModelProvider {
  id = "reflection-policy-test";
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
        skillId === "memory-extraction-content-policy" ? { skill_id: skillId, instructions: SKILL_INSTRUCTIONS } : null,
      ),
  });
}

function embedding(): IMemoryEmbeddingService {
  return castAny<IMemoryEmbeddingService>({
    searchByEmbedding: () => Promise.resolve([]),
    getEmbedding: () => Promise.resolve(null),
    deleteEmbedding: () => Promise.resolve(),
    getStats: () => Promise.resolve({ total: 0, generated_at: "" }),
  });
}

Deno.test("synthesis prompt includes the Step 1 content-curation skill instructions by explicit skill_id", async () => {
  const { config, db, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    await bank.addGlobalLearning(
      createSampleLearning({
        id: crypto.randomUUID(),
        title: "Some approved learning",
        description: "Content worth reflecting on.",
        status: MemoryStatus.APPROVED,
      }),
    );
    const extractor = new MemoryExtractorService(config, db, castAny<IMemoryBankService>(bank));
    const provider = new CapturingProvider(JSON.stringify({ actions: [] }));
    const reflection = new MemoryReflectionService({
      provider,
      skillsService: skillsService(),
      memoryBank: bank,
      embeddingService: embedding(),
      proposalWriter: extractor,
    });

    await reflection.runReflectionCycle();

    assertStringIncludes(provider.prompt, SKILL_INSTRUCTIONS.slice(0, 80));
    assertStringIncludes(provider.prompt, "untrusted");
  } finally {
    await cleanup();
  }
});

Deno.test("a structural-fact restatement is pruned while a genuine decision entry is retained", async () => {
  const { config, db, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    const structural = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Import structure of the billing module",
      description: "File billing/invoice.ts imports billing/pricing.ts which exports price().",
      status: MemoryStatus.APPROVED,
    });
    const genuineDecision = createSampleLearning({
      id: crypto.randomUUID(),
      title: "Always price invoices against the pricing service, and why",
      description:
        "Invoice totals must come from the pricing service because tax rules change per region and duplicating them caused double-taxing bugs.",
      category: LearningCategory.DECISION,
      status: MemoryStatus.APPROVED,
    });
    await bank.addGlobalLearning(structural);
    await bank.addGlobalLearning(genuineDecision);
    const extractor = new MemoryExtractorService(config, db, castAny<IMemoryBankService>(bank));
    const reflection = new MemoryReflectionService({
      provider: new CapturingProvider(JSON.stringify({
        actions: [
          {
            action: "prune",
            target_id: structural.id,
            reason: "Merely restates import structure derivable from portal-knowledge source analysis",
          },
        ],
      })),
      skillsService: skillsService(),
      memoryBank: bank,
      embeddingService: embedding(),
      proposalWriter: extractor,
    });

    const result = await reflection.runReflectionCycle();

    assertEquals(result.pruned_count, 1);
    assertEquals(
      (await bank.getGlobalMemory())!.learnings.find((l) => l.id === structural.id)!.status,
      MemoryStatus.DELETED,
    );
    assertEquals(
      (await bank.getGlobalMemory())!.learnings.find((l) => l.id === genuineDecision.id)!.status,
      MemoryStatus.APPROVED,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("missing content-policy skill fails the cycle loudly", async () => {
  const { config, db, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();
    const extractor = new MemoryExtractorService(config, db, castAny<IMemoryBankService>(bank));
    const missingSkill = castAny<Pick<ISkillsService, "getSkill">>({ getSkill: () => Promise.resolve(null) });
    const reflection = new MemoryReflectionService({
      provider: new CapturingProvider(JSON.stringify({ actions: [] })),
      skillsService: missingSkill,
      memoryBank: bank,
      embeddingService: embedding(),
      proposalWriter: extractor,
    });

    const failure = await assertRejects(
      () => reflection.runReflectionCycle(),
      Error,
      "memory-extraction-content-policy",
    );
    assertEquals(failure instanceof Error, true);
  } finally {
    await cleanup();
  }
});
