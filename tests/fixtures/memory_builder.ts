/**
 * @module MemoryFixtureBuilder
 * @path tests/fixtures/memory_builder.ts
 * @description Provides a fluent builder for simulating complex agent memory structures,
 * including multi-project patterns, decision logs, and execution records.
 */

import {
  ConfidenceAssessmentLevel,
  ExecutionStatus,
  LearningCategory,
  MemoryBankSource,
  MemoryScope,
} from "../../src/shared/enums.ts";
import { MemoryStatus } from "../../src/shared/status/memory_status.ts";
import type {
  IChanges,
  IDecision,
  IExecutionMemory,
  ILearning,
  IPattern,
  IProjectMemory,
  IReference,
} from "../../src/shared/schemas/memory_bank.ts";

/**
 * Builder for IProjectMemory objects to simplify test data creation
 */
export class ProjectMemoryBuilder {
  private memory: IProjectMemory;

  constructor(portal: string = "test-portal") {
    this.memory = {
      portal,
      overview: `Overview for ${portal}`,
      patterns: [],
      decisions: [],
      references: [],
    };
  }

  public withOverview(overview: string): this {
    this.memory.overview = overview;
    return this;
  }

  public addPattern(pattern: Partial<IPattern> & { name: string }): this {
    this.memory.patterns.push({
      description: "Default description",
      examples: [],
      tags: [],
      ...pattern,
    });
    return this;
  }

  public addDecision(decision: Partial<IDecision> & { decision: string; date: string }): this {
    this.memory.decisions.push({
      rationale: "Default rationale",
      tags: [],
      ...decision,
    });
    return this;
  }

  public addReference(reference: IReference): this {
    this.memory.references.push(reference);
    return this;
  }

  public build(): IProjectMemory {
    return { ...this.memory };
  }
}

/**
 * Builder for IExecutionMemory objects to simplify test data creation
 */
export class ExecutionMemoryBuilder {
  private memory: IExecutionMemory;

  constructor(portal: string = "test-portal", traceId: string = crypto.randomUUID()) {
    this.memory = {
      trace_id: traceId,
      request_id: `req-${traceId.substring(0, 8)}`,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: ExecutionStatus.COMPLETED,
      portal,
      identity_id: "test-agent",
      summary: `Test execution for ${portal}`,
      context_files: [],
      context_portals: [portal],
      changes: {
        files_created: [],
        files_modified: [],
        files_deleted: [],
      },
      lessons_learned: [],
    };
  }

  public withRequestId(requestId: string): this {
    this.memory.request_id = requestId;
    return this;
  }

  public withStatus(status: ExecutionStatus): this {
    this.memory.status = status;
    return this;
  }

  public withIdentity(identity: string): this {
    this.memory.identity_id = identity;
    return this;
  }

  public withSummary(summary: string): this {
    this.memory.summary = summary;
    return this;
  }

  public withChanges(changes: Partial<IChanges>): this {
    this.memory.changes = {
      ...this.memory.changes,
      ...changes,
    };
    return this;
  }

  public addContextFile(path: string): this {
    this.memory.context_files.push(path);
    return this;
  }

  public addLesson(lesson: string): this {
    if (!this.memory.lessons_learned) {
      this.memory.lessons_learned = [];
    }
    this.memory.lessons_learned.push(lesson);
    return this;
  }

  public build(): IExecutionMemory {
    // Return a deep copy to prevent mutation issues in tests
    return JSON.parse(JSON.stringify(this.memory));
  }
}

/**
 * Builder for ILearning objects to simplify test data creation
 */
export class LearningBuilder {
  private learning: ILearning;

  constructor() {
    this.learning = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      source: MemoryBankSource.USER,
      scope: MemoryScope.GLOBAL,
      title: "Test ILearning",
      description: "Test description",
      category: LearningCategory.PATTERN,
      tags: [],
      confidence: ConfidenceAssessmentLevel.HIGH,
      status: MemoryStatus.APPROVED,
    } as ILearning;
  }

  public withTitle(title: string): this {
    this.learning.title = title;
    return this;
  }

  public withDescription(description: string): this {
    this.learning.description = description;
    return this;
  }

  public withScope(scope: MemoryScope | string, project?: string): this {
    this.learning.scope = scope as MemoryScope;
    if (project) {
      this.learning.project = project;
    }
    return this;
  }

  public withCategory(category: LearningCategory | string): this {
    this.learning.category = category as LearningCategory;
    return this;
  }

  public withTags(tags: string[]): this {
    this.learning.tags = tags;
    return this;
  }

  public build(): ILearning {
    return JSON.parse(JSON.stringify(this.learning));
  }
}
