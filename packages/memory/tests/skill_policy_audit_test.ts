/**
 * @module SkillPolicyAuditTest
 * @path packages/memory/tests/skill_policy_audit_test.ts
 * @description Phase 206 Step 4 — both memory policy provider boundaries durably snapshot the
 *   content-policy skill revision before the provider call. An edit to the policy changes the
 *   recorded revision on the next operation, and a failed snapshot write stops the operation with
 *   zero provider calls. A real SkillsService and journal DB back every case.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/memory, @exaix/core/skills, @exaix/testing]
 * @related-files [packages/memory/src/extraction/llm_learning_extractor.ts, packages/memory/src/reflection/memory_reflection_service.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import type { IModelProvider } from "@exaix/ai";
import type { IMemoryBankService, IMemoryCostRouter, IMemoryEmbeddingService } from "@exaix/core/types";
import { EventLogger } from "@exaix/core/logger";
import { MemoryStatus } from "@exaix/core/status";
import { SkillAuditUnavailableError, SkillsService } from "@exaix/core/skills";
import {
  LlmLearningExtractor,
  MemoryBankService,
  MemoryExtractorService,
  MemoryReflectionService,
} from "@exaix/memory";
import {
  castAny,
  createMinimalExecutionMemory,
  createSampleLearning,
  initTestDbService,
  writeSkillFolder,
} from "@exaix/testing";

const POLICY_SKILL = "memory-extraction-content-policy";

class CountingProvider implements IModelProvider {
  id = "policy-audit";
  calls = 0;
  constructor(private content: string) {}
  generate() {
    this.calls++;
    return Promise.resolve({
      content: this.content,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: "mock-memory",
      provider: "mock",
      cost_usd: 0,
    });
  }
}

interface IFixture {
  skills: SkillsService;
  skillsDir: string;
  db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  config: Awaited<ReturnType<typeof initTestDbService>>["config"];
  cleanup: () => Promise<void>;
}

async function fixture(): Promise<IFixture> {
  const env = await initTestDbService();
  const base = await Deno.makeTempDir({ prefix: "exa-policy-audit-" });
  const skillsDir = join(base, "Blueprints", "Skills");
  await writeSkillFolder(skillsDir, { name: POLICY_SKILL, instructions: "Policy body one." });
  const skills = new SkillsService(
    { memoryDir: join(base, "Memory"), blueprintSkillsDir: skillsDir },
    env.db,
    undefined,
    new EventLogger({ db: env.db }),
  );
  await skills.initialize();
  return {
    skills,
    skillsDir,
    db: env.db,
    config: env.config,
    cleanup: async () => {
      await env.cleanup();
      await Deno.remove(base, { recursive: true }).catch(() => {});
    },
  };
}

async function policyBodies(fx: IFixture): Promise<string[]> {
  const rows = await fx.db.preparedAll<{ skill_md: string }>(
    "SELECT skill_md FROM skill_revisions WHERE skill_name = ? ORDER BY first_seen_at, rowid",
    [POLICY_SKILL],
  );
  return rows.map((row) => row.skill_md);
}

const COST_ROUTER = castAny<IMemoryCostRouter>({ recordOperation: () => Promise.resolve() });
const EXTRACTION_RESPONSE = JSON.stringify({ learnings: [] });

Deno.test("[extractor] extract snapshots the policy revision before the provider call and an edit changes it", async () => {
  const fx = await fixture();
  try {
    const provider = new CountingProvider(EXTRACTION_RESPONSE);
    const extractor = new LlmLearningExtractor(provider, fx.skills, COST_ROUTER);
    await extractor.extract(createMinimalExecutionMemory({}));
    assertEquals((await policyBodies(fx)).map((md) => md.includes("Policy body one.")), [true]);

    await writeSkillFolder(fx.skillsDir, { name: POLICY_SKILL, instructions: "Policy body two." });
    await extractor.extract(createMinimalExecutionMemory({}));
    const bodies = await policyBodies(fx);
    assertEquals(bodies.length, 2);
    assertEquals(bodies[1].includes("Policy body two."), true);
    assertEquals(provider.calls, 2);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[extractor] a failed snapshot write stops extraction with zero provider calls", async () => {
  const fx = await fixture();
  try {
    await fx.db.preparedRun("DROP TABLE skill_revisions");
    const provider = new CountingProvider(EXTRACTION_RESPONSE);
    const extractor = new LlmLearningExtractor(provider, fx.skills, COST_ROUTER);
    await assertRejects(() => extractor.extract(createMinimalExecutionMemory({})), SkillAuditUnavailableError);
    assertEquals(provider.calls, 0);
  } finally {
    await fx.cleanup();
  }
});

async function reflectionService(fx: IFixture, provider: CountingProvider): Promise<MemoryReflectionService> {
  const bank = new MemoryBankService(fx.config);
  await bank.initGlobalMemory();
  await bank.addGlobalLearning(
    createSampleLearning({
      id: crypto.randomUUID(),
      title: "An approved learning",
      description: "Content worth reflecting on.",
      status: MemoryStatus.APPROVED,
    }),
  );
  return new MemoryReflectionService({
    provider,
    skillsService: fx.skills,
    memoryBank: bank,
    embeddingService: castAny<IMemoryEmbeddingService>({
      searchByEmbedding: () => Promise.resolve([]),
      getEmbedding: () => Promise.resolve(null),
      deleteEmbedding: () => Promise.resolve(),
      getStats: () => Promise.resolve({ total: 0, generated_at: "" }),
    }),
    proposalWriter: new MemoryExtractorService(fx.config, fx.db, castAny<IMemoryBankService>(bank)),
  });
}

Deno.test("[reflection] runReflectionCycle snapshots the policy revision before synthesis and an edit changes it", async () => {
  const fx = await fixture();
  try {
    const provider = new CountingProvider(JSON.stringify({ actions: [] }));
    const reflection = await reflectionService(fx, provider);
    await reflection.runReflectionCycle();
    assertEquals((await policyBodies(fx)).map((md) => md.includes("Policy body one.")), [true]);

    await writeSkillFolder(fx.skillsDir, { name: POLICY_SKILL, instructions: "Policy body two." });
    await reflection.runReflectionCycle();
    assertEquals((await policyBodies(fx)).length, 2);
    assertEquals(provider.calls, 2);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[reflection] a failed snapshot write stops the cycle with zero provider calls", async () => {
  const fx = await fixture();
  try {
    await fx.db.preparedRun("DROP TABLE skill_revisions");
    const provider = new CountingProvider(JSON.stringify({ actions: [] }));
    const reflection = await reflectionService(fx, provider);
    await assertRejects(() => reflection.runReflectionCycle(), SkillAuditUnavailableError);
    assertEquals(provider.calls, 0);
  } finally {
    await fx.cleanup();
  }
});
