// deno-lint-ignore-file no-explicit-any
/**
 * @module MemoryFormatterTest
 * @path tests/tui/memory_view/formatters_test.ts
 * @description Verifies the logic for formatting memory metadata in the TUI, ensuring correct
 * display of project-specific, global, and execution-linked knowledge details.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";

import { MemoryFormatter } from "../../../src/tui/memory_view/formatters.ts";
import { MemoryTuiScope } from "../../../src/tui/memory_view/memory_scope.ts";
import type { IMemoryService, ITreeNode } from "../../../src/tui/memory_view/types.ts";
import type {
  IExecutionMemory,
  IGlobalMemory,
  ILearning,
  IMemoryUpdateProposal,
  IProjectMemory,
} from "@exaix/schemas/memory_bank.ts";
import {
  ConfidenceAssessmentLevel,
  ExecutionStatus,
  LearningCategory,
  MemoryBankSource,
  MemoryOperation,
  MemoryScope,
} from "@exaix/core";
import { TuiNodeType } from "@exaix/tui";
import { createMockService } from "./memory_test_helpers.ts";
import {
  TUI_DETAIL_MAX_OVERVIEW_CHARS,
  TUI_MSG_PRESS_QUIT,
  TUI_PREFIX_EXECUTION,
  TUI_PREFIX_PROJECT,
} from "@exaix/tui/helpers/constants.ts";
import { MemoryStatus } from "@exaix/core/status";

function node(id: string, label = id, data?: any, badge?: number): ITreeNode {
  return {
    id,
    type: TuiNodeType.GROUP,
    label,
    expanded: true,
    children: [],
    data,
    badge,
  };
}

Deno.test("MemoryFormatter.formatScopeDetail: covers known scopes and fallback", () => {
  const globalMemory: IGlobalMemory = {
    version: "1.0",
    updated_at: new Date().toISOString(),
    learnings: [
      {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        source: MemoryBankSource.USER,
        scope: "global",
        title: "L1",
        description: "desc",
        category: LearningCategory.INSIGHT,
        tags: [],
        confidence: ConfidenceAssessmentLevel.HIGH,
        status: "approved",
      } as ILearning,
    ],
    patterns: [],
    anti_patterns: [],
    statistics: { total_learnings: 1, by_category: {}, by_project: {}, last_activity: new Date().toISOString() },
  };

  const global = MemoryFormatter.formatScopeDetail(node(MemoryTuiScope.GLOBAL, "Global", globalMemory));
  assertStringIncludes(global, "# Global Memory");
  assertStringIncludes(global, "Learnings:");

  const projects = MemoryFormatter.formatScopeDetail(node(MemoryTuiScope.PROJECTS, "Projects", undefined, 2));
  assertStringIncludes(projects, "2 project memories");

  const executions = MemoryFormatter.formatScopeDetail(node(MemoryTuiScope.EXECUTIONS, "Executions", undefined, 3));
  assertStringIncludes(executions, "3 total executions");

  const pending = MemoryFormatter.formatScopeDetail(node(MemoryTuiScope.PENDING, "Pending", undefined, 4));
  assertStringIncludes(pending, "4 proposals awaiting review");

  const other = MemoryFormatter.formatScopeDetail(node("other", "Other"));
  assertStringIncludes(other, "Scope: Other");
});

Deno.test("MemoryFormatter.formatProjectDetail: returns message when project memory missing", async () => {
  const n = node(`${TUI_PREFIX_PROJECT}portal1`, "portal1", null);

  const service = createMockService({ getProjectMemory: () => Promise.resolve(null) });

  const result = await MemoryFormatter.formatProjectDetail(n, service);
  assertStringIncludes(result, "has no memory bank");
});

Deno.test("MemoryFormatter.formatExecutionDetail: loads fresh execution when data is null", async () => {
  const exec: IExecutionMemory = {
    trace_id: "trace-12345678",
    request_id: "request-trace-123",
    status: ExecutionStatus.COMPLETED,
    identity_id: "a",
    portal: "p",
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    summary: "s",
    context_files: [],
    context_portals: [],
    changes: { files_created: [], files_modified: [], files_deleted: [] },
  };

  const n = node(`${TUI_PREFIX_EXECUTION}${exec.trace_id}`, "exec", null);
  const service = {
    getExecutionByTraceId: () => Promise.resolve(exec),
  } as Partial<IMemoryService> as IMemoryService;

  const result = await MemoryFormatter.formatExecutionDetail(n, service);
  assertStringIncludes(result, "# Execution:");
  assertStringIncludes(result, "**Identity:** a");
});

Deno.test("MemoryFormatter.formatLearningDetail: renders proposal learning content", () => {
  const proposal: IMemoryUpdateProposal = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    operation: MemoryOperation.ADD,
    target_scope: MemoryScope.GLOBAL,
    target_project: undefined,
    learning: {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      source: MemoryBankSource.USER,
      scope: MemoryScope.GLOBAL,
      title: "Learn",
      description: "Desc",
      category: LearningCategory.INSIGHT,
      tags: ["t"],
      confidence: ConfidenceAssessmentLevel.HIGH,
    },
    reason: "Because",
    identity_id: "agent",
    execution_id: "trace",
    status: MemoryStatus.PENDING,
  };

  const out = MemoryFormatter.formatLearningDetail(node("x", "x", proposal), false);
  assertStringIncludes(out, "Learn");
  assertStringIncludes(out, "Reason for Proposal");
  assertStringIncludes(out, "[a] Approve");
});

Deno.test("MemoryFormatter.formatProjectMemory: truncates long overview and lists patterns", () => {
  const memory: IProjectMemory = {
    portal: "portal",
    overview: "x".repeat(TUI_DETAIL_MAX_OVERVIEW_CHARS + 5),
    patterns: [
      { name: "P1", description: "desc", examples: [], tags: ["tag"] },
    ],
    decisions: [
      { decision: "D1", rationale: "rationale", date: new Date().toISOString().split("T")[0], tags: [] },
    ],
    references: [],
  };

  const out = MemoryFormatter.formatProjectMemory("portal", memory);
  assertStringIncludes(out, "# Project: portal");
  assertStringIncludes(out, "## Overview");
  assertStringIncludes(out, "...");
  assertStringIncludes(out, "## Patterns");
  assertStringIncludes(out, "P1");
  assertStringIncludes(out, "## Decisions");
});

Deno.test("MemoryFormatter.formatExecutionMemory: includes changes only when present", () => {
  const base: IExecutionMemory = {
    trace_id: "trace-12345678",
    request_id: "request-123",
    status: ExecutionStatus.COMPLETED,
    identity_id: "a",
    portal: "p",
    started_at: new Date().toISOString(),
    summary: "",
    context_files: [],
    context_portals: [],
    changes: { files_created: [], files_modified: [], files_deleted: [] },
  };

  const noChanges = MemoryFormatter.formatExecutionMemory(base);
  assertEquals(noChanges.includes("## Changes"), false);

  const withChanges = MemoryFormatter.formatExecutionMemory({
    ...base,
    changes: { files_created: ["a"], files_modified: [], files_deleted: [] },
  });
  assertEquals(withChanges.includes("## Changes"), true);
  assertStringIncludes(withChanges, "Created: 1 files");
});

Deno.test("MemoryFormatter.formatDetailWithQuit: appends quit hint", () => {
  const out = MemoryFormatter.formatDetailWithQuit("Hello");
  assertEquals(out.endsWith(TUI_MSG_PRESS_QUIT), true);
});
