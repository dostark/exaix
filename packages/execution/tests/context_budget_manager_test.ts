/**
 * @module ContextBudgetManagerTest
 * @path packages/execution/tests/context_budget_manager_test.ts
 * @description Tests for ContextBudgetManager: segment prioritisation, budget enforcement,
 * protected-class invariant, statelessness, and snapshot correctness.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/execution/src/context/context_budget_manager.ts",
 *   "packages/execution/src/context/context_segment.ts"
 * ]
 */

import { assertEquals, assertGreater, assertLessOrEqual } from "@std/assert";
import {
  CONTEXT_PRIORITY_ACCEPTANCE_CRITERIA,
  CONTEXT_PRIORITY_PORTAL_KNOWLEDGE,
  CONTEXT_PRIORITY_SYSTEM,
  CONTEXT_PRIORITY_TOOL_RESULT,
} from "@exaix/core";
import type { IContextBudgetManager } from "@exaix/execution";
import type { IContextSegment } from "@exaix/execution";
import { ContextBudgetManager } from "@exaix/execution";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSegment(
  overrides: Partial<IContextSegment> & { kind: IContextSegment["kind"] },
): IContextSegment {
  return {
    segmentId: crypto.randomUUID(),
    content: "x".repeat(100),
    priority: 50,
    tokenEstimate: 25,
    metadata: {},
    ...overrides,
  };
}

/** IPromptBudget stub with a generous loopHistory budget. */
function makePromptBudget(loopHistoryTokens = 10_000) {
  return {
    model: "anthropic:claude-3-5-sonnet",
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

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("[ContextBudgetManager] returns all segments unchanged when total tokens under budget", async () => {
  const manager: IContextBudgetManager = new ContextBudgetManager();
  const segments: IContextSegment[] = [
    makeSegment({ kind: "system", priority: CONTEXT_PRIORITY_SYSTEM, tokenEstimate: 100 }),
    makeSegment({ kind: "tool_result", priority: CONTEXT_PRIORITY_TOOL_RESULT, tokenEstimate: 50 }),
  ];

  const { segments: out, snapshot } = await manager.prepare({
    traceId: "trace-1",
    stepId: "step-1",
    model: "anthropic:claude-3-5-sonnet",
    promptBudget: makePromptBudget(),
    segments,
  });

  assertEquals(out.length, 2);
  assertEquals(snapshot.overflowRecovered, false);
  assertEquals(snapshot.decisions.length, 2);
  assertEquals(snapshot.decisions.every((d) => d.action === "keep"), true);
});

Deno.test("[ContextBudgetManager] drops lowest-priority segments first when over budget", async () => {
  const manager: IContextBudgetManager = new ContextBudgetManager();

  // loopHistory budget = 0 → any tool_result segment is immediately dropped.
  // portal_knowledge maps to sections.portalKnowledge which remains generous.
  const segments: IContextSegment[] = [
    makeSegment({ kind: "system", priority: CONTEXT_PRIORITY_SYSTEM, tokenEstimate: 10 }),
    makeSegment({
      kind: "tool_result",
      priority: CONTEXT_PRIORITY_TOOL_RESULT,
      tokenEstimate: 50,
    }),
    makeSegment({
      kind: "portal_knowledge",
      priority: CONTEXT_PRIORITY_PORTAL_KNOWLEDGE,
      tokenEstimate: 20,
    }),
  ];

  const { segments: out, snapshot } = await manager.prepare({
    traceId: "trace-2",
    stepId: "step-1",
    model: "anthropic:claude-3-5-sonnet",
    promptBudget: makePromptBudget(0), // zero loopHistory budget forces tool_result drop
    segments,
  });

  const dropped = snapshot.decisions.filter((d) => d.action === "drop");
  assertGreater(dropped.length, 0);

  // tool_result (lowest priority) dropped; system (highest) kept
  const keptKinds = out.map((s) => s.kind);
  assertEquals(keptKinds.includes("system"), true);
  assertEquals(keptKinds.includes("tool_result"), false);
});

Deno.test("[ContextBudgetManager] never drops segments with priority >= CONTEXT_PRIORITY_ACCEPTANCE_CRITERIA", async () => {
  const manager: IContextBudgetManager = new ContextBudgetManager();

  const segments: IContextSegment[] = [
    makeSegment({
      kind: "acceptance_criteria",
      priority: CONTEXT_PRIORITY_ACCEPTANCE_CRITERIA,
      tokenEstimate: 999_999, // intentionally huge
    }),
    makeSegment({ kind: "tool_result", priority: CONTEXT_PRIORITY_TOOL_RESULT, tokenEstimate: 50 }),
  ];

  const { segments: out } = await manager.prepare({
    traceId: "trace-3",
    stepId: "step-1",
    model: "anthropic:claude-3-5-sonnet",
    promptBudget: makePromptBudget(10), // very tight
    segments,
  });

  const keptKinds = out.map((s) => s.kind);
  assertEquals(keptKinds.includes("acceptance_criteria"), true);
});

Deno.test("[ContextBudgetManager] snapshot.decisions count equals number of segments processed", async () => {
  const manager: IContextBudgetManager = new ContextBudgetManager();
  const segments: IContextSegment[] = [
    makeSegment({ kind: "system", priority: CONTEXT_PRIORITY_SYSTEM, tokenEstimate: 10 }),
    makeSegment({ kind: "tool_result", priority: CONTEXT_PRIORITY_TOOL_RESULT, tokenEstimate: 10 }),
    makeSegment({
      kind: "portal_knowledge",
      priority: CONTEXT_PRIORITY_PORTAL_KNOWLEDGE,
      tokenEstimate: 10,
    }),
  ];

  const { snapshot } = await manager.prepare({
    traceId: "trace-4",
    stepId: "step-1",
    model: "anthropic:claude-3-5-sonnet",
    promptBudget: makePromptBudget(),
    segments,
  });

  assertEquals(snapshot.decisions.length, segments.length);
});

Deno.test("[ContextBudgetManager] snapshot.overflowRecovered is false when sync compaction fits budget", async () => {
  const manager: IContextBudgetManager = new ContextBudgetManager();

  const { snapshot } = await manager.prepare({
    traceId: "trace-5",
    stepId: "step-1",
    model: "anthropic:claude-3-5-sonnet",
    promptBudget: makePromptBudget(),
    segments: [
      makeSegment({ kind: "system", priority: CONTEXT_PRIORITY_SYSTEM, tokenEstimate: 10 }),
    ],
  });

  assertEquals(snapshot.overflowRecovered, false);
});

Deno.test("[ContextBudgetManager] empty segment list is valid input — returns zero decisions", async () => {
  const manager: IContextBudgetManager = new ContextBudgetManager();

  const { segments: out, snapshot } = await manager.prepare({
    traceId: "trace-6",
    stepId: "step-1",
    model: "anthropic:claude-3-5-sonnet",
    promptBudget: makePromptBudget(),
    segments: [],
  });

  assertEquals(out.length, 0);
  assertEquals(snapshot.decisions.length, 0);
  assertEquals(snapshot.overflowRecovered, false);
});

Deno.test("[ContextBudgetManager] concurrent prepare() calls for same traceId produce independent snapshots", async () => {
  const manager: IContextBudgetManager = new ContextBudgetManager();
  const seg = makeSegment({ kind: "system", priority: CONTEXT_PRIORITY_SYSTEM, tokenEstimate: 5 });

  const [r1, r2] = await Promise.all([
    manager.prepare({
      traceId: "trace-concurrent",
      stepId: "step-A",
      model: "anthropic:claude-3-5-sonnet",
      promptBudget: makePromptBudget(),
      segments: [seg],
    }),
    manager.prepare({
      traceId: "trace-concurrent",
      stepId: "step-B",
      model: "anthropic:claude-3-5-sonnet",
      promptBudget: makePromptBudget(),
      segments: [seg],
    }),
  ]);

  assertEquals(r1.snapshot.stepId, "step-A");
  assertEquals(r2.snapshot.stepId, "step-B");
});

Deno.test("[ContextBudgetManager] snapshot.durationMs is a non-negative integer", async () => {
  const manager: IContextBudgetManager = new ContextBudgetManager();

  const { snapshot } = await manager.prepare({
    traceId: "trace-7",
    stepId: "step-1",
    model: "anthropic:claude-3-5-sonnet",
    promptBudget: makePromptBudget(),
    segments: [
      makeSegment({ kind: "system", priority: CONTEXT_PRIORITY_SYSTEM, tokenEstimate: 5 }),
    ],
  });

  assertEquals(typeof snapshot.durationMs, "number");
  assertLessOrEqual(0, snapshot.durationMs!);
});
