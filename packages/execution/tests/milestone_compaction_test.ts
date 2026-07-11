/**
 * @module MilestoneCompactionTest
 * @path packages/execution/tests/milestone_compaction_test.ts
 * @description Tests for context.compaction.applied milestone emission from ContextBudgetManager (Phase 92).
 * @architectural-layer Tests
 * @related-files [packages/execution/src/context/context_budget_manager.ts]
 */

import { assertEquals } from "@std/assert";
import { CONTEXT_PRIORITY_TOOL_RESULT, MILESTONE_CONTEXT_COMPACTION_APPLIED } from "@exaix/core";
import { ContextBudgetManager, NoopContextCompactor } from "@exaix/execution";
import type { IContextBudgetManager } from "@exaix/execution";
import type { IMilestoneEmitter } from "@exaix/core/observability";
import type { IExecutionMilestone } from "@exaix/schemas/milestone_event.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface IContextSegmentOverrides {
  segmentId: string;
  kind:
    | "system"
    | "request"
    | "portal_knowledge"
    | "summary"
    | "acceptance_criteria"
    | "plan_step"
    | "tool_result"
    | "reflection";
  priority: number;
  tokenEstimate: number;
  content: string;
  metadata: Record<string, string | boolean | number | undefined>;
}

type IContextSegment = IContextSegmentOverrides;

function makeSegment(overrides: Partial<IContextSegment> & { kind: IContextSegment["kind"] }): IContextSegment {
  return {
    segmentId: crypto.randomUUID(),
    content: "x".repeat(100),
    priority: 50,
    tokenEstimate: 25,
    metadata: {},
    ...overrides,
  };
}

function makePromptBudget(loopHistoryTokens = 10_000) {
  return {
    model: "anthropic:claude-sonnet-5",
    totalBudgetTokens: 200_000,
    safetyBufferTokens: 20_000,
    sections: {
      system: 40_000,
      plan: 70_000,
      portalKnowledge: 40_000,
      memory: 20_000,
      skills: 20_000,
      loopHistory: loopHistoryTokens,
    },
  };
}

class MockMilestoneEmitter implements IMilestoneEmitter {
  readonly emitted: IExecutionMilestone[] = [];

  emit(milestone: IExecutionMilestone): Promise<void> {
    this.emitted.push(milestone);
    return Promise.resolve();
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test(
  "ContextBudgetManager: emits context.compaction.applied milestone when compaction occurs",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const mockEmitter = new MockMilestoneEmitter();
    const compactor = new NoopContextCompactor();

    const manager: IContextBudgetManager = new ContextBudgetManager(
      undefined,
      compactor,
      undefined,
      undefined,
      mockEmitter,
    );

    await manager.prepare({
      traceId: "trace-compaction-milestone",
      stepId: "step-1",
      model: "anthropic:claude-sonnet-5",
      promptBudget: makePromptBudget(0),
      segments: [
        makeSegment({ kind: "tool_result", priority: CONTEXT_PRIORITY_TOOL_RESULT, tokenEstimate: 50 }),
      ],
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    assertEquals(mockEmitter.emitted.length, 1);
    assertEquals(mockEmitter.emitted[0].milestoneType, MILESTONE_CONTEXT_COMPACTION_APPLIED);
    assertEquals(mockEmitter.emitted[0].requiresAttention, false);
    assertEquals(mockEmitter.emitted[0].traceId, "trace-compaction-milestone");
    assertEquals(mockEmitter.emitted[0].summary.includes("compacted"), true);
  },
);

Deno.test(
  "ContextBudgetManager: does not emit compaction milestone when no compaction occurs",
  async () => {
    const mockEmitter = new MockMilestoneEmitter();

    const manager: IContextBudgetManager = new ContextBudgetManager(
      undefined,
      undefined,
      undefined,
      undefined,
      mockEmitter,
    );

    await manager.prepare({
      traceId: "trace-no-compaction",
      stepId: "step-1",
      model: "anthropic:claude-sonnet-5",
      promptBudget: makePromptBudget(100_000),
      segments: [
        makeSegment({ kind: "tool_result", priority: CONTEXT_PRIORITY_TOOL_RESULT, tokenEstimate: 50 }),
      ],
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    assertEquals(mockEmitter.emitted.length, 0);
  },
);

Deno.test(
  "ContextBudgetManager: does not emit compaction milestone when emitter is undefined",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const compactor = new NoopContextCompactor();

    const manager: IContextBudgetManager = new ContextBudgetManager(
      undefined,
      compactor,
      undefined,
      undefined,
      undefined,
    );

    const { snapshot } = await manager.prepare({
      traceId: "trace-no-emitter",
      stepId: "step-1",
      model: "anthropic:claude-sonnet-5",
      promptBudget: makePromptBudget(0),
      segments: [
        makeSegment({ kind: "tool_result", priority: CONTEXT_PRIORITY_TOOL_RESULT, tokenEstimate: 50 }),
      ],
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    assertEquals(snapshot.overflowRecovered, true);
  },
);
