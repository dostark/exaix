/**
 * @module MemoryBankTestHelpers
 * @path packages/testing/src/helpers/services/memory_bank_test_helpers.ts
 * @related-files []
 * @architectural-layer Testing
 * @ungrounded
 * @description Data factories for MemoryBank tests (project/execution memory,
 * learnings, patterns, decisions). The DB-backed harness lives in
 * packages/memory/tests/helpers/memory_bank_harness.ts.
 */

import type { ILearning, IPattern } from "@exaix/schemas/memory_bank.ts";
import type { IExecutionMemory, IProjectMemory } from "@exaix/schemas/memory_bank.ts";
import type { IDecision } from "@exaix/schemas/memory_bank.ts";
import {
  ConfidenceAssessmentLevel,
  ExecutionStatus,
  LearningCategory,
  MemoryBankSource,
  MemoryReferenceType,
  MemoryScope,
} from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { TEST_IDENTITY_ID, TEST_PORTAL_NAME, TEST_SAMPLE_PREFIX, TEST_TIMESTAMP } from "../constants.ts";
import type { Opt, Reason } from "@exaix/core/types";

/**
 * Creates a minimal valid IProjectMemory for testing
 */
export function createMinimalProjectMemory(overrides: Partial<IProjectMemory> = {}): IProjectMemory {
  return {
    portal: overrides.portal ?? TEST_PORTAL_NAME,
    overview: overrides.overview ?? "Test project overview",
    patterns: overrides.patterns ?? [],
    decisions: overrides.decisions ?? [],
    references: overrides.references ?? [],
    ...overrides,
  };
}

/**
 * Creates a IProjectMemory with sample data for testing
 */
export function createSampleProjectMemory(overrides: Partial<IProjectMemory> = {}): IProjectMemory {
  return {
    portal: overrides.portal ?? TEST_PORTAL_NAME,
    overview: overrides.overview ?? "A comprehensive test project with various memory components",
    patterns: overrides.patterns ?? [
      createSamplePattern(),
    ],
    decisions: overrides.decisions ?? [
      createSampleDecision(),
    ],
    references: overrides.references ?? [
      {
        type: MemoryReferenceType.FILE,
        path: "src/main.ts",
        description: "Main application entry point",
      },
    ],
    ...overrides,
  };
}

/**
 * Creates a minimal valid IExecutionMemory for testing
 */
export function createMinimalExecutionMemory(overrides: Partial<IExecutionMemory> = {}): IExecutionMemory {
  return {
    trace_id: overrides.trace_id ?? "test-trace-123",
    request_id: overrides.request_id ?? "req-123",
    started_at: overrides.started_at ?? "2026-01-04T10:00:00Z",
    completed_at: overrides.completed_at ?? "2026-01-04T10:30:00Z",
    status: overrides.status ?? ExecutionStatus.COMPLETED,
    portal: overrides.portal ?? TEST_PORTAL_NAME,
    identity_id: overrides.identity_id ?? TEST_IDENTITY_ID,
    summary: overrides.summary ?? "Test execution summary",
    context_files: overrides.context_files ?? [],
    context_portals: overrides.context_portals ?? [],
    changes: overrides.changes ?? {
      files_created: [],
      files_modified: [],
      files_deleted: [],
    },
    ...overrides,
  };
}

/**
 * Creates a sample ILearning for testing
 */
export function createSampleLearning(overrides: Partial<ILearning> = {}): ILearning {
  return {
    id: overrides.id ?? "learning-123",
    created_at: overrides.created_at ?? TEST_TIMESTAMP,
    source: overrides.source ?? MemoryBankSource.EXECUTION,
    source_id: overrides.source_id ?? "trace-123",
    scope: overrides.scope ?? MemoryScope.PROJECT,
    project: overrides.project ?? TEST_PORTAL_NAME,
    title: overrides.title ?? "Sample ILearning",
    description: overrides.description ?? "A sample learning entry",

    category: overrides.category ?? LearningCategory.PATTERN,
    tags: overrides.tags ?? [TEST_SAMPLE_PREFIX],
    confidence: overrides.confidence ?? ConfidenceAssessmentLevel.MEDIUM,
    references: overrides.references ?? [],
    status: overrides.status ?? MemoryStatus.APPROVED,
    ...overrides,
  };
}

/**
 * Creates a sample IPattern for testing
 */
export function createSamplePattern(
  overrides: Opt<Partial<IPattern>, Reason.TestOverride> = {},
): IPattern {
  return {
    name: overrides.name ?? "Sample IPattern",
    description: overrides.description ?? "A sample pattern",
    examples: overrides.examples ?? [],
    tags: overrides.tags ?? [TEST_SAMPLE_PREFIX],
    ...overrides,
  };
}

/**
 * Creates a sample IDecision for testing
 */
export function createSampleDecision(
  overrides: Opt<Partial<IDecision>, Reason.TestOverride> = {},
): IDecision {
  return {
    date: overrides.date ?? "2026-01-04",
    decision: overrides.decision ?? "Sample IDecision",
    rationale: overrides.rationale ?? "Sample rationale",
    alternatives: overrides.alternatives ?? ["Option A", "Option B"],
    tags: overrides.tags ?? [TEST_SAMPLE_PREFIX],
    ...overrides,
  };
}
