/**
 * @module MemoryServicesTestHelpers
 * @path packages/testing/src/helpers/services/memory_test_helpers.ts
 * @related-files []
 * @architectural-layer Testing
 * @ungrounded
 * @description Provides helper functions for simulating agent learning records
 * and verifying memory persistence in the MemoryBankService.
 */

import {
  ConfidenceAssessmentLevel,
  ExecutionStatus,
  LearningCategory,
  MemoryBankSource,
  MemoryOperation,
  MemoryScope,
  ReviewSource,
} from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import type { IExecutionMemory, ILearning, IMemoryUpdateProposal } from "@exaix/schemas/memory_bank.ts";
import type { MemoryExtractorService } from "@exaix/memory";
import type { JSONObject, Opt, Reason } from "@exaix/core/types";
import {
  TEST_AGENT_NAME,
  TEST_ID,
  TEST_IDENTITY_ID,
  TEST_PROJECT_NAME,
  TEST_TIMESTAMP,
  TEST_TOPIC_LABEL,
} from "../constants.ts";

export function createSuccessfulExecutionMemory(portal: string, traceId: string): IExecutionMemory {
  return {
    trace_id: traceId,
    request_id: `req-${traceId.substring(0, 8)}`,
    started_at: "2026-01-04T10:00:00Z",
    completed_at: "2026-01-04T10:30:00Z",
    status: ExecutionStatus.COMPLETED,
    portal,
    identity_id: TEST_AGENT_NAME,
    summary:
      "Implemented repository pattern for database access. Created UserRepository with CRUD operations. Added proper error handling with typed exceptions.",
    context_files: ["src/services/user.ts", "src/types/errors.ts"],
    context_portals: [portal],
    changes: {
      files_created: ["src/repos/user_repo.ts", "src/types/repo_errors.ts"],
      files_modified: ["src/services/user.ts"],
      files_deleted: [],
    },
    lessons_learned: [
      "Repository pattern improves testability",
      "Typed errors make debugging easier",
    ],
  };
}

export function createFailedExecutionMemory(portal: string, traceId: string): IExecutionMemory {
  return {
    trace_id: traceId,
    request_id: `req-${traceId.substring(0, 8)}`,
    started_at: "2026-01-04T11:00:00Z",
    completed_at: "2026-01-04T11:15:00Z",
    status: ExecutionStatus.FAILED,
    portal,
    identity_id: TEST_AGENT_NAME,
    summary: "Failed to implement feature due to missing dependency configuration.",
    context_files: ["src/config.ts"],
    context_portals: [portal],
    changes: {
      files_created: [],
      files_modified: [],
      files_deleted: [],
    },
    error_message: "Module not found: @db/sqlite. Ensure dependencies are installed.",
    lessons_learned: ["Always verify dependencies before implementation"],
  };
}

/** Creates a test execution with learnable content and returns a proposal ID. */
export async function createTestProposal(
  extractor: MemoryExtractorService,
  portal: string = TEST_PROJECT_NAME,
  traceId?: Opt<string, Reason.TestOverride>,
): Promise<string | null> {
  // Use a unique trace ID if not provided
  const executionTraceId = traceId ??
    `550e8400-e29b-41d4-a716-44665544${Math.random().toString().slice(2, 4).padStart(3, "0")}`;

  const execution = createSuccessfulExecutionMemory(portal, executionTraceId);

  const learnings = await extractor.analyzeExecution(execution);

  if (learnings.length === 0) {
    return null;
  }

  return await extractor.createProposal(learnings[0], execution, TEST_AGENT_NAME);
}

/**
 * Base learning object for testing
 */
export function createBaseLearning(
  overrides: Partial<IMemoryUpdateProposal["learning"]> = {},
): IMemoryUpdateProposal["learning"] {
  return {
    id: overrides.id ?? "550e8400-e29b-41d4-a716-446655440001",
    created_at: overrides.created_at ?? TEST_TIMESTAMP,
    source: overrides.source ?? MemoryBankSource.EXECUTION,
    source_id: overrides.source_id ?? "trace-123",
    scope: overrides.scope ?? MemoryScope.PROJECT,
    project: overrides.project ?? TEST_PROJECT_NAME,
    title: overrides.title ?? "Use repository pattern",
    description: overrides.description ?? "Database access should go through repositories",
    category: overrides.category ?? LearningCategory.PATTERN,
    tags: overrides.tags ?? ["architecture"],
    confidence: overrides.confidence ?? ConfidenceAssessmentLevel.MEDIUM,
    references: overrides.references ?? [],
  };
}

/**
 * Creates a full ILearning object for testing
 */
export function createTestLearning(overrides: Partial<ILearning> = {}): ILearning {
  return {
    ...createBaseLearning(overrides),
    status: overrides.status ?? MemoryStatus.APPROVED,
    ...overrides,
  } as ILearning;
}

/**
 * Creates a minimal valid IMemoryUpdateProposal for testing
 */
export function createMinimalProposal(overrides: Partial<IMemoryUpdateProposal> = {}): IMemoryUpdateProposal {
  return createBaseProposal({
    learning: createBaseLearning(overrides.learning),
    reason: overrides.reason ?? "Extracted from successful execution",
    identity_id: overrides.identity_id ?? TEST_AGENT_NAME,
    ...overrides,
  });
}

/**
 * Creates a global scope proposal for testing
 */
export function createGlobalProposal(overrides: Partial<IMemoryUpdateProposal> = {}): IMemoryUpdateProposal {
  return {
    id: overrides.id ?? "550e8400-e29b-41d4-a716-446655440002",
    created_at: overrides.created_at ?? TEST_TIMESTAMP,
    operation: overrides.operation ?? MemoryOperation.PROMOTE,
    target_scope: overrides.target_scope ?? MemoryScope.GLOBAL,
    learning: createBaseLearning({
      id: "550e8400-e29b-41d4-a716-446655440003",
      source: MemoryBankSource.IDENTITY,
      scope: MemoryScope.GLOBAL,
      title: "Always validate input",
      description: "Input validation prevents security issues",
      category: LearningCategory.INSIGHT,
      tags: ["security"],
      confidence: ConfidenceAssessmentLevel.HIGH,

      ...overrides.learning,
    }),
    reason: overrides.reason ?? "IPattern observed across multiple projects",

    identity_id: overrides.identity_id ?? "architect",

    status: overrides.status ?? MemoryStatus.PENDING,
    ...overrides,
  };
}

/**
 * Creates an approved proposal for testing
 */
export function createApprovedProposal(overrides: Partial<IMemoryUpdateProposal> = {}): IMemoryUpdateProposal {
  return {
    id: overrides.id ?? "550e8400-e29b-41d4-a716-446655440004",
    created_at: overrides.created_at ?? TEST_TIMESTAMP,
    operation: overrides.operation ?? MemoryOperation.ADD,
    target_scope: overrides.target_scope ?? MemoryScope.PROJECT,
    target_project: overrides.target_project ?? TEST_PROJECT_NAME,
    learning: createBaseLearning({
      id: "550e8400-e29b-41d4-a716-446655440005",
      source: MemoryBankSource.USER,
      title: "Test ILearning",
      description: "Test description",
      category: LearningCategory.PATTERN,
      tags: [],
      confidence: ConfidenceAssessmentLevel.LOW,
      ...overrides.learning,
    }),
    reason: overrides.reason ?? "User requested",
    identity_id: overrides.identity_id ?? "user-cli",
    status: overrides.status ?? MemoryStatus.APPROVED,
    reviewed_at: overrides.reviewed_at ?? "2026-01-04T13:00:00Z",
    reviewed_by: overrides.reviewed_by ?? ReviewSource.USER,
    ...overrides,
  };
}

/**
 * Creates an invalid proposal for testing schema validation failures
 */
export function createInvalidProposal(overrides: Partial<IMemoryUpdateProposal> = {}): JSONObject {
  const base = createBaseProposal({
    id: "550e8400-e29b-41d4-a716-446655440006",
    operation: MemoryOperation.ADD, // placeholder
    learning: createInvalidLearning(overrides.learning),
    reason: TEST_TOPIC_LABEL,
    identity_id: TEST_ID,
    status: MemoryStatus.PENDING,
  });

  return {
    ...base,
    operation: "invalid-op",
    ...overrides,
  };
}

/**
 * Creates an invalid proposal with invalid status for testing
 */
export function createInvalidStatusProposal(overrides: Partial<IMemoryUpdateProposal> = {}): JSONObject {
  const base = createBaseProposal({
    id: "550e8400-e29b-41d4-a716-446655440008",
    operation: MemoryOperation.ADD,
    learning: createInvalidLearning(overrides.learning),
    reason: TEST_TOPIC_LABEL,
    identity_id: TEST_ID,
    status: MemoryStatus.PENDING,
  });

  return {
    ...base,
    status: "invalid-status",
    ...overrides,
  };
}

/**
 * Creates a test learning object for invalid proposals
 */
function createInvalidLearning(
  overrides: Partial<IMemoryUpdateProposal["learning"]> = {},
): IMemoryUpdateProposal["learning"] {
  return {
    id: overrides.id ?? "550e8400-e29b-41d4-a716-446655440007",
    created_at: overrides.created_at ?? TEST_TIMESTAMP,
    source: overrides.source ?? MemoryBankSource.USER,
    scope: overrides.scope ?? MemoryScope.PROJECT,
    title: overrides.title ?? TEST_TOPIC_LABEL,
    description: overrides.description ?? TEST_TOPIC_LABEL,
    category: overrides.category ?? LearningCategory.PATTERN,
    tags: overrides.tags ?? [],
    confidence: overrides.confidence ?? ConfidenceAssessmentLevel.LOW,
    ...overrides,
  };
}

/**
 * Base proposal creation function to reduce duplication
 */
function createBaseProposal(overrides: Partial<IMemoryUpdateProposal> = {}): IMemoryUpdateProposal {
  return {
    id: overrides.id ?? "550e8400-e29b-41d4-a716-446655440000",
    created_at: overrides.created_at ?? TEST_TIMESTAMP,
    operation: overrides.operation ?? MemoryOperation.ADD,
    target_scope: overrides.target_scope ?? MemoryScope.PROJECT,
    target_project: overrides.target_project ?? TEST_PROJECT_NAME,
    learning: overrides.learning ?? createBaseLearning(),
    reason: overrides.reason ?? "Test proposal",
    identity_id: overrides.identity_id ?? TEST_IDENTITY_ID,
    execution_id: overrides.execution_id ?? "trace-123",
    status: overrides.status ?? MemoryStatus.PENDING,
    ...overrides,
  };
}
