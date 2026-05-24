/**
 * @module MemoryBudgetEnforcementTest
 * @path tests/integration/services/memory_budget_enforcement_test.ts
 * @description Integration tests for Phase 62 Step 62.3 budget enforcement in
 * SessionMemoryService and SkillsService.
 * @architectural-layer Test
 * @related-files [packages/memory/src/session/session_memory.ts, packages/core/src/skills/skills.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { SessionMemoryService } from "@exaix/memory";
import { SkillsService } from "@exaix/core/skills";
import type { IMemorySearchResult } from "@exaix/schemas/memory_bank.ts";
import { DEFAULT_GLOBAL_MEMORY_VERSION, MemoryBankSource, MemoryScope, MemoryType, SkillStatus } from "@exaix/core";
import { initTestDbService } from "@exaix/testing";
import { NullEmbeddingStub, NullMemoryBankStub } from "@exaix/testing";

class BudgetMemoryBankMock extends NullMemoryBankStub {
  constructor(private readonly searchResults: IMemorySearchResult[]) {
    super();
  }

  override searchMemory(
    _query: string,
    _options?: { portal?: string; limit?: number },
  ): Promise<IMemorySearchResult[]> {
    return Promise.resolve(this.searchResults);
  }
}

Deno.test("[Step62.3] SessionMemoryService.lookupMemories accepts token cap", async () => {
  const memoryBank = new BudgetMemoryBankMock([
    {
      type: MemoryType.PATTERN,
      portal: "test-portal",
      title: "Pattern A",
      summary: "A".repeat(60),
      relevance_score: 0.9,
      tags: ["patterns"],
    },
    {
      type: MemoryType.DECISION,
      portal: "test-portal",
      title: "Decision B",
      summary: "B".repeat(60),
      relevance_score: 0.8,
      tags: ["decisions"],
    },
  ]);
  const embeddingService = new NullEmbeddingStub();
  const service = new SessionMemoryService(memoryBank, embeddingService, {
    includeLearnings: false,
    topK: 5,
  });

  const capped = await service.lookupMemories("budget test", 30, {
    includeLearnings: false,
  });
  const uncapped = await service.lookupMemories("budget test", undefined, {
    includeLearnings: false,
  });

  assertEquals(capped.length, 1);
  assertEquals(uncapped.length, 2);
});

Deno.test("[Step62.3] SkillsService.matchSkills respects provided context budget", async () => {
  const { db, config, cleanup } = await initTestDbService();

  try {
    const service = new SkillsService(
      { memoryDir: join(config.system.root, config.paths.memory) },
      db,
    );
    await service.initialize();

    for (const suffix of ["one", "two"]) {
      await service.createSkill({
        skill_id: `budget-${suffix}`,
        name: `Budget ${suffix}`,
        version: DEFAULT_GLOBAL_MEMORY_VERSION,
        description: "Budget-aware skill description ".repeat(2),
        scope: MemoryScope.GLOBAL,
        status: SkillStatus.ACTIVE,
        source: MemoryBankSource.USER,
        triggers: { keywords: ["budget"] },
        instructions: "Follow the budget-constrained workflow carefully. ".repeat(3),
      });
    }

    const capped = await service.matchSkills({
      keywords: ["budget"],
      contextBudgetChars: 280,
    });
    const uncapped = await service.matchSkills({
      keywords: ["budget"],
    });

    assertEquals(capped.matches.length, 1);
    assertEquals(uncapped.matches.length, 2);
  } finally {
    await cleanup();
  }
});
