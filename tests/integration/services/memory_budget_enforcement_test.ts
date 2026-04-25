/**
 * @module MemoryBudgetEnforcementTest
 * @path tests/integration/services/memory_budget_enforcement_test.ts
 * @description Integration tests for Phase 62 Step 62.3 budget enforcement in
 * SessionMemoryService and SkillsService.
 * @architectural-layer Test
 * @related-files [src/services/memory/session_memory.ts, src/services/skills/skills.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { SessionMemoryService } from "../../../src/services/memory/session_memory.ts";
import type { IEmbeddingSearchResult, IMemoryEmbeddingService } from "../../../src/services/memory/memory_embedding.ts";
import { SkillsService } from "../../../src/services/skills/skills.ts";
import type { IMemoryBankService } from "../../../src/shared/interfaces/i_memory_bank_service.ts";
import type {
  IActivitySummary,
  IDecision,
  IExecutionMemory,
  IGlobalMemory,
  ILearning,
  IMemorySearchResult,
  IPattern,
  IProjectMemory,
} from "@exaix/schemas/memory_bank.ts";
import { MemoryBankSource, MemoryScope, MemoryType, SkillStatus } from "@exaix/core";
import { DEFAULT_GLOBAL_MEMORY_VERSION } from "@exaix/core";
import { initTestDbService } from "../../helpers/db.ts";

class BudgetMemoryBankMock implements IMemoryBankService {
  constructor(
    private readonly searchResults: IMemorySearchResult[],
  ) {}

  getProjectMemory(_portal: string): Promise<IProjectMemory | null> {
    return Promise.resolve(null);
  }
  createProjectMemory(_projectMem: IProjectMemory): Promise<void> {
    return Promise.resolve();
  }
  updateProjectMemory(_portal: string, _updates: Partial<Omit<IProjectMemory, "portal">>): Promise<void> {
    return Promise.resolve();
  }
  addPattern(_portal: string, _pattern: IPattern): Promise<void> {
    return Promise.resolve();
  }
  addDecision(_portal: string, _decision: IDecision): Promise<void> {
    return Promise.resolve();
  }
  createExecutionRecord(_execution: IExecutionMemory): Promise<void> {
    return Promise.resolve();
  }
  getExecutionByTraceId(_traceId: string): Promise<IExecutionMemory | null> {
    return Promise.resolve(null);
  }
  getExecutionHistory(_portal?: string, _limit?: number): Promise<IExecutionMemory[]> {
    return Promise.resolve([]);
  }
  getGlobalMemory(): Promise<IGlobalMemory | null> {
    return Promise.resolve(null);
  }
  initGlobalMemory(): Promise<void> {
    return Promise.resolve();
  }
  addGlobalLearning(_learning: ILearning): Promise<void> {
    return Promise.resolve();
  }
  promoteLearning(
    _portal: string,
    _promotion: {
      type: MemoryType.PATTERN | MemoryType.DECISION;
      name: string;
      title: string;
      description: string;
      category: ILearning["category"];
      tags: string[];
      confidence: ILearning["confidence"];
    },
  ): Promise<string> {
    return Promise.resolve("");
  }
  demoteLearning(_learningId: string, _targetPortal: string): Promise<void> {
    return Promise.resolve();
  }
  searchMemory(_query: string, _options?: { portal?: string; limit?: number }): Promise<IMemorySearchResult[]> {
    return Promise.resolve(this.searchResults);
  }
  searchByTags(_tags: string[], _options?: { portal?: string; limit?: number }): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }
  searchByKeyword(_keyword: string, _options?: { portal?: string; limit?: number }): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }
  searchMemoryAdvanced(
    _options: { tags?: string[]; keyword?: string; portal?: string; limit?: number },
  ): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }
  getRecentActivity(_limit?: number): Promise<IActivitySummary[]> {
    return Promise.resolve([]);
  }
  rebuildIndices(): Promise<void> {
    return Promise.resolve();
  }
  rebuildIndicesWithEmbeddings(_embeddingService: IMemoryEmbeddingService): Promise<void> {
    return Promise.resolve();
  }
  getProjects(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

class BudgetEmbeddingMock implements IMemoryEmbeddingService {
  initializeManifest(): Promise<void> {
    return Promise.resolve();
  }
  embedLearning(_learning: ILearning): Promise<void> {
    return Promise.resolve();
  }
  searchByEmbedding(
    _query: string,
    _options?: { limit?: number; threshold?: number },
  ): Promise<IEmbeddingSearchResult[]> {
    return Promise.resolve([]);
  }
  getEmbedding(_id: string): Promise<number[] | null> {
    return Promise.resolve(null);
  }
  deleteEmbedding(_id: string): Promise<void> {
    return Promise.resolve();
  }
  getStats(): Promise<{ total: number; generated_at: string }> {
    return Promise.resolve({ total: 0, generated_at: "" });
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
  const embeddingService = new BudgetEmbeddingMock();
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
