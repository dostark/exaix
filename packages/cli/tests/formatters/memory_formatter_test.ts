/**
 * @module MemoryFormatterTest
 * @path packages/cli/tests/formatters/memory_formatter_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Verifies CLI output formatting for complex memory structures, ensuring
 * tabular views for project patterns, decision logs, and execution summaries remain legible.
 */

import { assertStringIncludes } from "@std/assert";
import { MemoryFormatter } from "@exaix/cli/formatters/memory_formatter.ts";
import {
  ConfidenceAssessmentLevel,
  ExecutionStatus,
  LearningCategory,
  MemoryBankSource,
  MemoryOperation,
  MemoryReferenceType,
  MemoryScope,
  SkillStatus,
} from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import type {
  IExecutionMemory,
  IGlobalMemory,
  IGlobalMemoryStats,
  ILearning,
  IMemoryUpdateProposal,
  IProjectMemory,
  ISkill,
  ISkillMatch,
} from "@exaix/schemas/memory_bank.ts";
import {
  TEST_AGENT_NAME,
  TEST_COMPLETED_AT,
  TEST_CONTEXT_FILE,
  TEST_DECISION_DATE,
  TEST_DECISION_RATIONALE,
  TEST_DECISION_TEXT,
  TEST_ERROR_TEXT,
  TEST_GLOBAL_CATEGORY,
  TEST_GLOBAL_PROJECT,
  TEST_GLOBAL_UPDATED_AT,
  TEST_GLOBAL_VERSION,
  TEST_LESSON_TEXT,
  TEST_PATTERN_DESCRIPTION,
  TEST_PATTERN_EXAMPLE,
  TEST_PATTERN_NAME,
  TEST_PATTERN_TAG,
  TEST_PENDING_LEARNING_DESCRIPTION,
  TEST_PENDING_LEARNING_TITLE,
  TEST_PENDING_REASON,
  TEST_PORTAL_NAME,
  TEST_PROJECT_OVERVIEW,
  TEST_REFERENCE_DESCRIPTION,
  TEST_REFERENCE_PATH,
  TEST_REQUEST_ID,
  TEST_SKILL_DESCRIPTION,
  TEST_SKILL_ID,
  TEST_SKILL_INSTRUCTIONS,
  TEST_SKILL_KEYWORD,
  TEST_SKILL_NAME,
  TEST_SKILL_TAG,
  TEST_SKILL_TASK_TYPE,
  TEST_SKILL_VERSION,
  TEST_STARTED_AT,
  TEST_SUMMARY_TEXT,
  TEST_TRACE_ID,
} from "@exaix/testing";

const MSG_NO_EXECUTIONS = "No execution history";

function createProjectMemory(): IProjectMemory {
  return {
    portal: TEST_PORTAL_NAME,
    overview: TEST_PROJECT_OVERVIEW,
    patterns: [
      {
        name: TEST_PATTERN_NAME,
        description: TEST_PATTERN_DESCRIPTION,
        examples: [TEST_PATTERN_EXAMPLE],
        tags: [TEST_PATTERN_TAG],
      },
    ],
    decisions: [
      {
        date: TEST_DECISION_DATE,
        decision: TEST_DECISION_TEXT,
        rationale: TEST_DECISION_RATIONALE,
        alternatives: [],
      },
    ],
    references: [
      {
        type: MemoryReferenceType.FILE,
        path: TEST_REFERENCE_PATH,
        description: TEST_REFERENCE_DESCRIPTION,
      },
    ],
  };
}

function createExecutionMemory(): IExecutionMemory {
  return {
    trace_id: TEST_TRACE_ID,
    request_id: TEST_REQUEST_ID,
    started_at: TEST_STARTED_AT,
    completed_at: TEST_COMPLETED_AT,
    status: ExecutionStatus.COMPLETED,
    portal: TEST_PORTAL_NAME,
    identity_id: TEST_AGENT_NAME,
    summary: TEST_SUMMARY_TEXT,
    context_files: [TEST_CONTEXT_FILE],
    context_portals: [TEST_PORTAL_NAME],
    changes: {
      files_created: [TEST_CONTEXT_FILE],
      files_modified: [],
      files_deleted: [],
    },
    lessons_learned: [TEST_LESSON_TEXT],
    error_message: TEST_ERROR_TEXT,
  };
}

function createGlobalStats(): IGlobalMemoryStats {
  return {
    total_learnings: 1,
    by_category: { [TEST_GLOBAL_CATEGORY]: 1 },
    by_project: { [TEST_GLOBAL_PROJECT]: 1 },
    last_activity: TEST_GLOBAL_UPDATED_AT,
  };
}

function createLearning(): ILearning {
  return {
    id: TEST_TRACE_ID,
    created_at: TEST_GLOBAL_UPDATED_AT,
    source: MemoryBankSource.USER,
    scope: MemoryScope.GLOBAL,
    project: undefined,
    title: TEST_PATTERN_NAME,
    description: TEST_PATTERN_DESCRIPTION,
    category: LearningCategory.PATTERN,
    tags: [TEST_PATTERN_TAG],
    confidence: ConfidenceAssessmentLevel.HIGH,
    references: [],
    status: MemoryStatus.APPROVED,
    approved_at: TEST_GLOBAL_UPDATED_AT,
    archived_at: undefined,
  };
}

function createGlobalMemory(): IGlobalMemory {
  return {
    version: TEST_GLOBAL_VERSION,
    updated_at: TEST_GLOBAL_UPDATED_AT,
    learnings: [createLearning()],
    patterns: [],
    anti_patterns: [],
    statistics: createGlobalStats(),
  };
}

function createPendingProposal(): IMemoryUpdateProposal {
  return {
    id: TEST_TRACE_ID,
    created_at: TEST_STARTED_AT,
    operation: MemoryOperation.ADD,
    target_scope: MemoryScope.GLOBAL,
    target_project: undefined,
    learning: {
      id: TEST_TRACE_ID,
      created_at: TEST_STARTED_AT,
      source: MemoryBankSource.USER,
      scope: MemoryScope.GLOBAL,
      title: TEST_PENDING_LEARNING_TITLE,
      description: TEST_PENDING_LEARNING_DESCRIPTION,
      category: LearningCategory.PATTERN,
      tags: [TEST_PATTERN_TAG],
      confidence: ConfidenceAssessmentLevel.HIGH,
      references: [],
    },
    reason: TEST_PENDING_REASON,
    identity_id: TEST_AGENT_NAME,
    execution_id: TEST_TRACE_ID,
    status: MemoryStatus.PENDING,
  };
}

function createSkill(): ISkill {
  return {
    id: TEST_TRACE_ID,
    skill_id: TEST_SKILL_ID,
    name: TEST_SKILL_NAME,
    source: MemoryBankSource.USER,
    scope: MemoryScope.PROJECT,
    version: TEST_SKILL_VERSION,
    status: SkillStatus.ACTIVE,
    description: TEST_SKILL_DESCRIPTION,
    instructions: TEST_SKILL_INSTRUCTIONS,
    created_at: TEST_STARTED_AT,
    usage_count: 0,
    triggers: {
      keywords: [TEST_SKILL_KEYWORD],
      task_types: [TEST_SKILL_TASK_TYPE],
      file_patterns: [],
      tags: [TEST_SKILL_TAG],
    },
  };
}

function createSkillMatch(): ISkillMatch {
  return {
    skillId: TEST_SKILL_ID,
    confidence: 0.92,
    matchedTriggers: {
      keywords: [TEST_SKILL_KEYWORD],
      task_types: [TEST_SKILL_TASK_TYPE],
      tags: [TEST_SKILL_TAG],
    },
  };
}

Deno.test("MemoryFormatter: formatProjectShowTable includes patterns, decisions, references", () => {
  const formatter = new MemoryFormatter();
  const result = formatter.formatProjectShowTable(createProjectMemory());

  assertStringIncludes(result, TEST_PATTERN_NAME);
  assertStringIncludes(result, TEST_DECISION_DATE);
  assertStringIncludes(result, TEST_REFERENCE_PATH);
});

Deno.test("MemoryFormatter: formatExecutionShowTable includes context, lessons, error", () => {
  const formatter = new MemoryFormatter();
  const result = formatter.formatExecutionShowTable(createExecutionMemory());

  assertStringIncludes(result, TEST_CONTEXT_FILE);
  assertStringIncludes(result, TEST_LESSON_TEXT);
  assertStringIncludes(result, TEST_ERROR_TEXT);
});

Deno.test("MemoryFormatter: formatExecutionListTable handles empty list", () => {
  const formatter = new MemoryFormatter();
  const result = formatter.formatExecutionListTable([]);

  assertStringIncludes(result, MSG_NO_EXECUTIONS);
});

Deno.test("MemoryFormatter: formatGlobalShowTable includes learning summary", () => {
  const formatter = new MemoryFormatter();
  const result = formatter.formatGlobalShowTable(createGlobalMemory());

  assertStringIncludes(result, TEST_GLOBAL_VERSION);
  assertStringIncludes(result, TEST_PATTERN_NAME);
});

Deno.test("MemoryFormatter: formatGlobalStatsTable includes category and project", () => {
  const formatter = new MemoryFormatter();
  const result = formatter.formatGlobalStatsTable(createGlobalStats());

  assertStringIncludes(result, TEST_GLOBAL_CATEGORY);
  assertStringIncludes(result, TEST_GLOBAL_PROJECT);
});

Deno.test("MemoryFormatter: formatExecutionShowMarkdown includes changes, lessons, error", () => {
  const formatter = new MemoryFormatter();
  const result = formatter.formatExecutionShowMarkdown(createExecutionMemory());

  assertStringIncludes(result, "## Changes");
  assertStringIncludes(result, TEST_CONTEXT_FILE);
  assertStringIncludes(result, "## Lessons Learned");
  assertStringIncludes(result, TEST_LESSON_TEXT);
  assertStringIncludes(result, "## Error");
  assertStringIncludes(result, TEST_ERROR_TEXT);
});

Deno.test("MemoryFormatter: formatPendingListMarkdown includes proposal details", () => {
  const formatter = new MemoryFormatter();
  const result = formatter.formatPendingListMarkdown([createPendingProposal()]);

  assertStringIncludes(result, "# Pending Memory Update Proposals");
  assertStringIncludes(result, TEST_PENDING_LEARNING_TITLE);
});

Deno.test("MemoryFormatter: formatPendingShowTable includes learning and reason", () => {
  const formatter = new MemoryFormatter();
  const result = formatter.formatPendingShowTable(createPendingProposal());

  assertStringIncludes(result, TEST_PENDING_LEARNING_DESCRIPTION);
  assertStringIncludes(result, TEST_PENDING_REASON);
});

Deno.test("MemoryFormatter: formatSkillShowTable includes triggers and instructions", () => {
  const formatter = new MemoryFormatter();
  const result = formatter.formatSkillShowTable(createSkill());

  assertStringIncludes(result, TEST_SKILL_KEYWORD);
  assertStringIncludes(result, TEST_SKILL_TASK_TYPE);
  assertStringIncludes(result, "more lines");
});

Deno.test("MemoryFormatter: formatSkillMatchTable includes trigger labels", () => {
  const formatter = new MemoryFormatter();
  const result = formatter.formatSkillMatchTable([createSkillMatch()]);

  assertStringIncludes(result, "kw:");
  assertStringIncludes(result, "tt:");
  assertStringIncludes(result, "tag:");
});
