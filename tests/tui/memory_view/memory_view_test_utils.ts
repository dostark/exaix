/**
 * @module MemoryViewTestUtils
 * @path tests/tui/memory_view/memory_view_test_utils.ts
 * @description Provides common utilities for mocking the Memory TUI state and
 * simulating keyboard-driven navigation in the knowledge tree.
 */

import {
  ConfidenceLevel,
  ExecutionStatus,
  LearningCategory,
  MemoryBankSource,
  MemoryOperation,
  MemoryReferenceType,
  MemoryScope,
  type MemoryType as _MemoryType,
} from "../../../src/shared/enums.ts";
import { MemoryStatus } from "../../../src/shared/status/memory_status.ts";
import { KEYS } from "../../../src/tui/helpers/keyboard.ts";
import type {
  IExecutionMemory,
  IGlobalMemory,
  IMemorySearchResult,
  IMemoryUpdateProposal,
  IProjectMemory,
} from "../../../src/shared/schemas/memory_bank.ts";
import type { IMemoryService } from "../../../src/tui/memory_view/types.ts";
import { MemoryViewTuiSession } from "../../../src/tui/memory_view.ts";
import type { DialogBase } from "../../../src/tui/helpers/dialog_base.ts";
import { DEFAULT_GLOBAL_MEMORY_VERSION } from "../../../src/shared/constants.ts";
// ===== Interfaces =====

export interface IMemoryViewServiceOptions {
  projects?: string[];
  executions?: IExecutionMemory[];
  pending?: IMemoryUpdateProposal[];
  globalMemory?: IGlobalMemory | null;
  projectMemories?: Record<string, IProjectMemory | null>;
  searchResults?: IMemorySearchResult[];
}

// ===== Mock Service =====

export class ExtendedMockMemoryService implements IMemoryService {
  private projects: string[] = ["TestPortal"];
  private projectMemories: Map<string, IProjectMemory | null> = new Map();
  private globalMemory: IGlobalMemory | null = null;
  private executions: IExecutionMemory[] = [];
  private pending: IMemoryUpdateProposal[] = [];
  private searchResults: IMemorySearchResult[] = [];

  setProjects(projects: string[]): void {
    this.projects = projects;
  }

  setProjectMemory(portal: string, memory: IProjectMemory | null): void {
    this.projectMemories.set(portal, memory);
  }

  setGlobalMemory(memory: IGlobalMemory | null): void {
    this.globalMemory = memory;
  }

  setExecutions(executions: IExecutionMemory[]): void {
    this.executions = executions;
  }

  setPending(pending: IMemoryUpdateProposal[]): void {
    this.pending = pending;
  }

  setSearchResults(results: IMemorySearchResult[]): void {
    this.searchResults = results;
  }

  async getProjects(): Promise<string[]> {
    return await this.projects;
  }

  async getProjectMemory(portal: string): Promise<IProjectMemory | null> {
    return await this.projectMemories.get(portal) ?? null;
  }

  async getGlobalMemory(): Promise<IGlobalMemory | null> {
    return await this.globalMemory;
  }

  async getExecutionByTraceId(traceId: string): Promise<IExecutionMemory | null> {
    return await this.executions.find((e) => e.trace_id === traceId) ?? null;
  }

  async getExecutionHistory(options?: { portal?: string; limit?: number }): Promise<IExecutionMemory[]> {
    let result = this.executions;
    if (options?.portal) {
      result = result.filter((e) => e.portal === options.portal);
    }
    if (options?.limit) {
      result = result.slice(0, options.limit);
    }
    return await result;
  }

  async search(query: string, _options?: { portal?: string; limit?: number }): Promise<IMemorySearchResult[]> {
    if (query === "") return [];
    return await this.searchResults;
  }

  async listPending(): Promise<IMemoryUpdateProposal[]> {
    return await this.pending;
  }

  async getPending(proposalId: string): Promise<IMemoryUpdateProposal | null> {
    return await this.pending.find((p) => p.id === proposalId) ?? null;
  }

  async approvePending(_proposalId: string): Promise<void> {
    this.pending = await this.pending.filter((p) => p.id !== _proposalId);
  }

  async rejectPending(_proposalId: string, _reason: string): Promise<void> {
    this.pending = await this.pending.filter((p) => p.id !== _proposalId);
  }
}

export function createMockProposal(id: string, title: string): IMemoryUpdateProposal {
  return {
    id,
    operation: MemoryOperation.ADD,
    target_scope: MemoryScope.PROJECT,
    target_project: "TestPortal",
    reason: "Test reason",
    identity_id: "test-agent",
    status: MemoryStatus.PENDING,
    created_at: new Date().toISOString(),
    learning: {
      id: `learning-${id}`,
      title,
      description: "Test learning description",
      category: LearningCategory.PATTERN,
      confidence: ConfidenceLevel.HIGH,
      source: MemoryBankSource.IDENTITY,
      scope: MemoryScope.PROJECT,
      project: "TestPortal",
      created_at: new Date().toISOString(),
      tags: ["test", "coverage"],
    },
  };
}

export function createMockExecution(
  traceId: string,
  status: ExecutionStatus.RUNNING | ExecutionStatus.COMPLETED | ExecutionStatus.FAILED,
): IExecutionMemory {
  return {
    trace_id: traceId,
    request_id: `request-${traceId}`,
    identity_id: "test-agent",
    portal: "TestPortal",
    started_at: new Date().toISOString(),
    completed_at: status === ExecutionStatus.RUNNING ? undefined : new Date().toISOString(),
    status,
    summary: "Test execution summary with some text",
    changes: {
      files_created: ["file1.ts", "file2.ts"],
      files_modified: ["modified.ts"],
      files_deleted: ["deleted.ts"],
    },
    context_files: ["context.md"],
    context_portals: ["TestPortal"],
    lessons_learned: ["Learned lesson 1", "Learned lesson 2"],
  };
}

export function createMockProjectMemory(portal: string): IProjectMemory {
  return {
    portal,
    overview: "This is a test project overview that is quite long to test truncation behavior in rendering.",
    patterns: [
      { name: "IPattern 1", description: "Description 1", examples: ["ex1.ts"], tags: ["tag1", "tag2"] },
      { name: "IPattern 2", description: "Description 2", examples: ["ex2.ts"] },
    ],
    decisions: [
      { decision: "IDecision 1", rationale: "Rationale 1", date: new Date().toISOString().split("T")[0] },
      { decision: "IDecision 2", rationale: "Rationale 2", date: new Date().toISOString().split("T")[0] },
    ],
    references: [
      { type: MemoryReferenceType.FILE, path: "src/test.ts", description: "Test file" },
    ],
  };
}

export function createMockGlobalMemory(): IGlobalMemory {
  return {
    version: DEFAULT_GLOBAL_MEMORY_VERSION,
    updated_at: new Date().toISOString(),
    patterns: [
      {
        name: "Global IPattern 1",
        description: "Description 1",
        applies_to: ["all"],
        examples: ["ex.ts"],
        tags: ["tag1"],
      },
    ],
    anti_patterns: [
      {
        name: "Anti-pattern 1",
        description: "Why to avoid",
        reason: "Bad",
        alternative: "Better",
        tags: ["avoid"],
      },
    ],
    learnings: [
      {
        id: "global-learning-1",
        title: "Global ILearning 1",
        description: "Description",
        category: LearningCategory.PATTERN,
        confidence: ConfidenceLevel.HIGH,
        source: MemoryBankSource.USER,
        scope: MemoryScope.GLOBAL,
        created_at: new Date().toISOString(),
        tags: ["tag1"],
        status: MemoryStatus.APPROVED,
      },
      {
        id: "global-learning-2",
        title: "Global ILearning 2",
        description: "Description",
        category: LearningCategory.INSIGHT,
        confidence: ConfidenceLevel.MEDIUM,
        source: MemoryBankSource.IDENTITY,
        scope: MemoryScope.GLOBAL,
        created_at: new Date().toISOString(),
        tags: ["tag2"],
        status: MemoryStatus.APPROVED,
      },
    ],
    statistics: {
      total_learnings: 2,
      by_category: { pattern: 1, insight: 1 },
      by_project: {},
      last_activity: new Date().toISOString(),
    },
  };
}

export function createTestSession(): MemoryViewTuiSession {
  const mockService = new ExtendedMockMemoryService();
  return new MemoryViewTuiSession(mockService as Partial<IMemoryService> as IMemoryService);
}

export function createConfiguredService(options: IMemoryViewServiceOptions = {}): ExtendedMockMemoryService {
  const service = new ExtendedMockMemoryService();
  service.setProjects(options.projects || []);
  service.setExecutions(options.executions || []);
  service.setPending(options.pending || []);
  service.setGlobalMemory(options.globalMemory ?? null);
  service.setSearchResults(options.searchResults || []);

  if (options.projectMemories) {
    for (const [portal, memory] of Object.entries(options.projectMemories)) {
      service.setProjectMemory(portal, memory);
    }
  }

  return service;
}

export async function setupSession(
  options: IMemoryViewServiceOptions = {},
): Promise<{ session: MemoryViewTuiSession; service: ExtendedMockMemoryService }> {
  const service = createConfiguredService(options);
  const session = createSessionWithService(service);
  await session.initialize();
  return { session, service };
}

export function createSessionWithService(service: ExtendedMockMemoryService): MemoryViewTuiSession {
  return new MemoryViewTuiSession(service as Partial<IMemoryService> as IMemoryService);
}

export async function testExecutionDetailRendering(exec: IExecutionMemory): Promise<string> {
  const { session } = await setupSession({
    executions: [exec],
  });

  await session.handleKey(KEYS.E);
  await session.handleKey(KEYS.ENTER);
  await session.handleKey(KEYS.DOWN);
  const detail = session.getDetailContent();

  if (typeof detail !== "string") {
    throw new Error("Detail content is not a string");
  }
  return detail;
}

export function renderDialog(dialog: DialogBase): string {
  return dialog.render({ width: 80, height: 20, useColors: true }).join("\n");
}

export function testSessionRender(
  name: string,
  options: IMemoryViewServiceOptions,
  keys: string[],
  check?: (session: MemoryViewTuiSession) => void | Promise<void>,
): void {
  Deno.test(name, async () => {
    const { session } = await setupSession(options);
    for (const key of keys) {
      await session.handleKey(key);
    }

    if (check) {
      await check(session);
    } else {
      const detail = session.getDetailContent();
      if (typeof detail !== "string") {
        throw new Error("Detail is not a string");
      }
    }
  });
}

export function testDialogInteraction<T extends DialogBase>(
  name: string,
  setup: () => { dialog: T; keys: string[] },
  verify: (dialog: T, rendered: string) => void,
): void {
  Deno.test(name, () => {
    const { dialog, keys } = setup();

    if (keys.length > 0) {
      for (const key of keys) {
        dialog.handleKey(key);
      }
    }

    const rendered = renderDialog(dialog);
    verify(dialog, rendered);
  });
}
