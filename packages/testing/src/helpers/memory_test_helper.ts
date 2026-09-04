/**
 * @module GlobalMemoryTestHelpers
 * @path packages/testing/src/helpers/memory_test_helper.ts
 * @related-files []
 * @architectural-layer Testing
 * @ungrounded
 * @description Provides common utilities for validating global knowledge banks
 * and shared learned patterns across project boundaries.
 */

import { ExecutionMemoryBuilder, ProjectMemoryBuilder } from "../../../../tests/fixtures/memory_builder.ts";
import type { MemoryBankService } from "@exaix/memory";
import type { IMemoryBankService } from "@exaix/core/types";
import type { IEmbeddingSearchResult } from "@exaix/memory";
import type { IEmbeddableMemoryEntry } from "@exaix/core/types";
import type { IMemoryEmbeddingService } from "@exaix/core/types";
import type {
  IActivitySummary,
  IDecision,
  IExecutionMemory,
  IGlobalMemory,
  ILearning,
  ILearningPatch,
  IMemorySearchResult,
  IPattern,
  IProjectMemory,
} from "@exaix/schemas/memory_bank.ts";
import type { MemoryType } from "@exaix/core";
import { MemoryReferenceType } from "@exaix/core";
import { TEST_AGENT_ROLE_ID } from "./constants.ts";
import type { Opt, Reason } from "@exaix/core/types";

/** No-op `IMemoryBankService` stub — extend and override only what a test needs. */
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
  getExecutionHistory(
    _portal?: Opt<string, Reason.AbstractBoundary>,
    _limit?: Opt<number, Reason.AbstractBoundary>,
  ): Promise<IExecutionMemory[]> {
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
  updateLearning(_id: string, _patch: ILearningPatch): Promise<void> {
    return Promise.resolve();
  }
  deleteLearning(_id: string, _reason?: Opt<string, Reason.AbstractBoundary>): Promise<void> {
    return Promise.resolve();
  }
  supersedeLearning(
    _oldId: string,
    _newLearning: ILearning,
    _reason?: Opt<string, Reason.AbstractBoundary>,
  ): Promise<void> {
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
  searchMemory(
    _query: string,
    _options?: Opt<{ portal?: string; limit?: number }, Reason.AbstractBoundary>,
  ): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }
  searchByTags(
    _tags: string[],
    _options?: Opt<{ portal?: string; limit?: number }, Reason.AbstractBoundary>,
  ): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }
  searchByKeyword(
    _keyword: string,
    _options?: Opt<{ portal?: string; limit?: number }, Reason.AbstractBoundary>,
  ): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }
  searchMemoryAdvanced(
    _options: { tags?: string[]; keyword?: string; portal?: string; limit?: number },
  ): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }
  getRecentActivity(_limit?: Opt<number, Reason.AbstractBoundary>): Promise<IActivitySummary[]> {
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

/** No-op `IMemoryEmbeddingService` stub — extend and override only what a test needs. */
export class NullEmbeddingStub implements IMemoryEmbeddingService {
  initializeManifest(): Promise<void> {
    return Promise.resolve();
  }
  embedLearning(_learning: ILearning): Promise<void> {
    return Promise.resolve();
  }
  embed(_entry: IEmbeddableMemoryEntry): Promise<void> {
    return Promise.resolve();
  }
  searchByEmbedding(
    _query: string,
    _options?: Opt<{ limit?: number; threshold?: number }, Reason.AbstractBoundary>,
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
    agent_role?: string;
    summary?: string;
  } = {},
): Promise<void> {
  const builder = new ExecutionMemoryBuilder(portal, traceId);

  builder.withAgentRole(opts.agent_role || TEST_AGENT_ROLE_ID);
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
