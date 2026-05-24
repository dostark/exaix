/**
 * @module GlobalMemoryTestHelpers
 * @path tests/helpers/memory_test_helper.ts
 * @description Provides common utilities for validating global knowledge banks
 * and shared learned patterns across project boundaries.
 */

import { ExecutionMemoryBuilder, ProjectMemoryBuilder } from "../../../../tests/fixtures/memory_builder.ts";
import type { MemoryBankService } from "@exaix/memory";
import type { IMemoryBankService } from "@exaix/core/types";
import type { IEmbeddingSearchResult, IMemoryEmbeddingService } from "@exaix/memory";
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
import type { MemoryType } from "@exaix/core";
import { MemoryReferenceType } from "@exaix/core";
import { TEST_IDENTITY_ID } from "./constants.ts";

/**
 * Base no-op stub for IMemoryBankService.
 * Extend this in tests and override only the methods you need.
 */
export class NullMemoryBankStub implements IMemoryBankService {
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
    return Promise.resolve([]);
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

/**
 * Base no-op stub for IMemoryEmbeddingService.
 * Extend this in tests and override only the methods you need.
 */
export class NullEmbeddingStub implements IMemoryEmbeddingService {
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

/**
 * Creates a test project memory using the Builder pattern and persistence
 */
export async function createTestProject(memoryBank: MemoryBankService, portal: string, opts: {
  overview?: string;
  patternName?: string;
} = {}): Promise<void> {
  const builder = new ProjectMemoryBuilder(portal);

  if (opts.overview) {
    builder.withOverview(opts.overview);
  }

  // Add default content similar to original test helper
  builder.addPattern({
    name: opts.patternName || "Test IPattern as IPattern",
    description: "A test pattern for unit testing",
    examples: ["src/test.ts"],
    tags: ["testing", "typescript"],
  });

  builder.addDecision({
    date: "2026-01-04",
    decision: "Use TypeScript for all code",
    rationale: "Type safety and tooling support",
    tags: ["typescript"],
  });

  builder.addReference({
    type: MemoryReferenceType.FILE,
    path: "src/main.ts",
    description: "Main entry point",
  });

  await memoryBank.createProjectMemory(builder.build());
}

/**
 * Creates a test execution memory using the Builder pattern and persistence
 */
export async function createTestExecution(
  memoryBank: MemoryBankService,
  traceId: string,
  portal: string,
  opts: {
    identity?: string;
    summary?: string;
  } = {},
): Promise<void> {
  const builder = new ExecutionMemoryBuilder(portal, traceId);

  builder.withIdentity(opts.identity || TEST_IDENTITY_ID);
  builder.withSummary(opts.summary || `Test execution for ${portal}`);
  builder.addContextFile("src/main.ts");
  builder.withChanges({
    files_created: ["src/new.ts"],
    files_modified: ["src/main.ts"],
    files_deleted: [],
  });
  builder.addLesson("Always test first");

  await memoryBank.createExecutionRecord(builder.build());
}
