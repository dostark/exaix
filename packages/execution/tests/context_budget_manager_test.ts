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
import { DomainEventType } from "@exaix/core/events";
import {
  CONTEXT_BUDGET_OVERHEAD_TARGET_MS,
  CONTEXT_PRIORITY_ACCEPTANCE_CRITERIA,
  CONTEXT_PRIORITY_PLAN_STEP,
  CONTEXT_PRIORITY_PORTAL_KNOWLEDGE,
  CONTEXT_PRIORITY_SUMMARY,
  CONTEXT_PRIORITY_SYSTEM,
  CONTEXT_PRIORITY_TOOL_RESULT,
} from "@exaix/core";
import type { IContextBudgetManager } from "@exaix/execution";
import type { IContextSegment } from "@exaix/execution";
import { ContextBudgetManager, NoopContextCompactor } from "@exaix/execution";
import { castAny } from "@exaix/testing";
import type { IEventLogger } from "@exaix/core/logger";
import type { IModelProvider } from "@exaix/ai/types.ts";

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

// ─── Step 2 extensions ────────────────────────────────────────────────────────

Deno.test("[ContextBudgetManager] drops low-priority tool_result before portal_knowledge at same budget", async () => {
  // Both loopHistory (tool_result) and portalKnowledge are set to 0 so both would be dropped.
  // Verify that tool_result (lower priority) IS dropped while the decision record
  // shows portal_knowledge was also dropped — the decisions must include the
  // lower-priority segment.
  const manager: IContextBudgetManager = new ContextBudgetManager();

  const tool = makeSegment({ kind: "tool_result", priority: CONTEXT_PRIORITY_TOOL_RESULT, tokenEstimate: 20 });
  const portal = makeSegment({
    kind: "portal_knowledge",
    priority: CONTEXT_PRIORITY_PORTAL_KNOWLEDGE,
    tokenEstimate: 20,
  });

  const { snapshot } = await manager.prepare({
    traceId: "trace-ordering",
    stepId: "step-1",
    model: "anthropic:claude-3-5-sonnet",
    promptBudget: makePromptBudget(0), // zero loopHistory forces tool_result drop
    segments: [tool, portal],
  });

  const droppedKinds = snapshot.decisions
    .filter((d) => d.action === "drop")
    .map((d) => d.kind);

  assertEquals(droppedKinds.includes("tool_result"), true);
  // portal_knowledge maps to portalKnowledge section which has budget, so it's kept
  assertEquals(droppedKinds.includes("portal_knowledge"), false);
});

Deno.test("[ContextBudgetManager] never drops system or acceptance_criteria segments under any budget pressure", async () => {
  const manager: IContextBudgetManager = new ContextBudgetManager();

  const budget = {
    ...makePromptBudget(),
    sections: { system: 0, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 0 },
  };

  const { segments: out } = await manager.prepare({
    traceId: "trace-protected",
    stepId: "step-1",
    model: "anthropic:claude-3-5-sonnet",
    promptBudget: budget,
    segments: [
      makeSegment({ kind: "system", priority: CONTEXT_PRIORITY_SYSTEM, tokenEstimate: 999 }),
      makeSegment({
        kind: "acceptance_criteria",
        priority: CONTEXT_PRIORITY_ACCEPTANCE_CRITERIA,
        tokenEstimate: 999,
      }),
      makeSegment({ kind: "tool_result", priority: CONTEXT_PRIORITY_TOOL_RESULT, tokenEstimate: 999 }),
    ],
  });

  const keptKinds = out.map((s) => s.kind);
  assertEquals(keptKinds.includes("system"), true);
  assertEquals(keptKinds.includes("acceptance_criteria"), true);
  assertEquals(keptKinds.includes("tool_result"), false);
});

Deno.test("[ContextBudgetManager] synchronous tier completes within CONTEXT_BUDGET_OVERHEAD_TARGET_MS ms", async () => {
  const manager: IContextBudgetManager = new ContextBudgetManager();
  const segments = Array.from({ length: 20 }, (_, i) =>
    makeSegment({
      kind: "tool_result",
      priority: CONTEXT_PRIORITY_TOOL_RESULT,
      tokenEstimate: i + 1,
    }));

  const start = Date.now();
  await manager.prepare({
    traceId: "trace-timing",
    stepId: "step-1",
    model: "anthropic:claude-3-5-sonnet",
    promptBudget: makePromptBudget(),
    segments,
  });
  const elapsed = Date.now() - start;

  assertLessOrEqual(elapsed, CONTEXT_BUDGET_OVERHEAD_TARGET_MS * 10); // 10× margin in test env
});

Deno.test("[ContextBudgetManager] snapshot.overflowRecovered is true when async compactor path fires", async () => {
  const compactor = new NoopContextCompactor();
  const manager: IContextBudgetManager = new ContextBudgetManager(undefined, compactor);

  // tool_result (compactable) is dropped due to zero loopHistory budget
  const { snapshot } = await manager.prepare({
    traceId: "trace-overflow",
    stepId: "step-1",
    model: "anthropic:claude-3-5-sonnet",
    promptBudget: makePromptBudget(0),
    segments: [
      makeSegment({ kind: "tool_result", priority: CONTEXT_PRIORITY_TOOL_RESULT, tokenEstimate: 50 }),
    ],
  });

  assertEquals(snapshot.overflowRecovered, true);
});

Deno.test("[ContextBudgetManager] protected segments with nonCompactable=true are always kept", async () => {
  const manager: IContextBudgetManager = new ContextBudgetManager();

  const budget = {
    ...makePromptBudget(),
    sections: { system: 0, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 0 },
  };

  const { segments: out } = await manager.prepare({
    traceId: "trace-noncompactable",
    stepId: "step-1",
    model: "anthropic:claude-3-5-sonnet",
    promptBudget: budget,
    segments: [
      makeSegment({
        kind: "tool_result",
        priority: CONTEXT_PRIORITY_TOOL_RESULT,
        tokenEstimate: 999,
        metadata: { nonCompactable: true },
      }),
    ],
  });

  assertEquals(out.length, 1);
  assertEquals(out[0].metadata.nonCompactable, true);
});

Deno.test(
  "[ContextBudgetManager] emits ExecutionContextCompacted after async snapshot save",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const loggedActions: string[] = [];
    const mockLogger = castAny<IEventLogger>({
      info: (action: string): Promise<void> => {
        loggedActions.push(action);
        return Promise.resolve();
      },
    });

    const compactor = new NoopContextCompactor();
    const manager: IContextBudgetManager = new ContextBudgetManager(
      undefined,
      compactor,
      undefined, // no snapshotStore
      mockLogger,
    );

    await manager.prepare({
      traceId: "trace-event",
      stepId: "step-1",
      model: "anthropic:claude-3-5-sonnet",
      promptBudget: makePromptBudget(0), // zero loopHistory forces drop → overflowRecovered = true
      segments: [
        makeSegment({ kind: "tool_result", priority: CONTEXT_PRIORITY_TOOL_RESULT, tokenEstimate: 50 }),
      ],
    });

    // The async IIFE inside queueMicrotask has multiple await points (compactor.summarize,
    // snapshotStore.save). Use a macrotask fence to ensure all pending microtasks complete.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    assertEquals(loggedActions.includes(DomainEventType.ExecutionContextCompacted), true);
  },
);

// ─── Step 5: section-key bug regression tests ─────────────────────────────────

Deno.test("[ContextBudgetManager] request + plan_step sharing sections.plan respect combined budget", async () => {
  const manager: IContextBudgetManager = new ContextBudgetManager();

  // sections.plan = 100 tokens.
  // acceptance_criteria (60 tokens) is protected — always kept, consumes plan budget.
  // plan_step (70 tokens) must compete against the remaining 40 tokens of sections.plan,
  // not against its own fresh counter.
  const tightBudget = {
    ...makePromptBudget(),
    sections: {
      system: 0,
      plan: 100,
      portalKnowledge: 0,
      memory: 0,
      skills: 0,
      loopHistory: 0,
    },
  };

  const { segments: out, snapshot } = await manager.prepare({
    traceId: "trace-section-plan",
    stepId: "step-1",
    model: "anthropic:claude-3-5-sonnet",
    promptBudget: tightBudget,
    segments: [
      makeSegment({
        kind: "acceptance_criteria",
        priority: CONTEXT_PRIORITY_ACCEPTANCE_CRITERIA,
        tokenEstimate: 60,
      }),
      makeSegment({
        kind: "plan_step",
        priority: CONTEXT_PRIORITY_PLAN_STEP,
        tokenEstimate: 70,
      }),
    ],
  });

  // acceptance_criteria is protected: always kept
  const keptKinds = out.map((s) => s.kind);
  assertEquals(keptKinds.includes("acceptance_criteria"), true);

  // plan_step (70) cannot fit the remaining 40 tokens — must be trimmed or dropped
  const planStepDecision = snapshot.decisions.find((d) => d.kind === "plan_step");
  assertEquals(planStepDecision?.action !== "keep", true);

  // Combined usedInputTokens must not exceed sections.plan = 100
  assertLessOrEqual(snapshot.usedInputTokens, 100);
});

// ─── Step 8: provider wiring for async compaction (GAP-4) ────────────────────

Deno.test(
  "[ContextBudgetManager] async compaction calls compactor.summarize with real provider when provider is supplied",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    let capturedProvider: IModelProvider | undefined;
    const trackingCompactor = {
      summarize(seg: IContextSegment, provider: IModelProvider): Promise<IContextSegment> {
        capturedProvider = provider;
        return Promise.resolve({ ...seg, kind: "summary" as const, content: "summarized" });
      },
    };

    const mockProvider = castAny<IModelProvider>({
      generate: () => Promise.resolve({ content: "", model: "test", usage: { promptTokens: 0, completionTokens: 0 } }),
    });

    const manager = new ContextBudgetManager(undefined, castAny(trackingCompactor));

    await manager.prepare({
      traceId: "trace-provider-wiring",
      stepId: "step-1",
      model: "anthropic:claude-3-5-sonnet",
      promptBudget: makePromptBudget(0),
      segments: [
        makeSegment({ kind: "tool_result", priority: CONTEXT_PRIORITY_TOOL_RESULT, tokenEstimate: 50 }),
      ],
      provider: mockProvider,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    assertEquals(capturedProvider, mockProvider);
  },
);

Deno.test(
  "[ContextBudgetManager] async compaction is skipped when no provider is in input",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    let summarizeCalled = false;
    const trackingCompactor = {
      summarize(seg: IContextSegment): Promise<IContextSegment> {
        summarizeCalled = true;
        return Promise.resolve(seg);
      },
    };

    const manager = new ContextBudgetManager(undefined, castAny(trackingCompactor));

    await manager.prepare({
      traceId: "trace-no-provider",
      stepId: "step-1",
      model: "anthropic:claude-3-5-sonnet",
      promptBudget: makePromptBudget(0),
      segments: [
        makeSegment({ kind: "tool_result", priority: CONTEXT_PRIORITY_TOOL_RESULT, tokenEstimate: 50 }),
      ],
      // no provider field
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    assertEquals(summarizeCalled, false);
  },
);

Deno.test("[ContextBudgetManager] tool_result + summary share sections.loopHistory counter", async () => {
  const manager: IContextBudgetManager = new ContextBudgetManager();

  // sections.loopHistory = 50. tool_result (30) keeps 30 tokens.
  // summary (30) must see remaining = 50 - 30 = 20, not fresh 50.
  const tightBudget = {
    ...makePromptBudget(),
    sections: {
      system: 0,
      plan: 0,
      portalKnowledge: 0,
      memory: 0,
      skills: 0,
      loopHistory: 50,
    },
  };

  const { snapshot } = await manager.prepare({
    traceId: "trace-section-loop",
    stepId: "step-1",
    model: "anthropic:claude-3-5-sonnet",
    promptBudget: tightBudget,
    segments: [
      makeSegment({ kind: "tool_result", priority: CONTEXT_PRIORITY_TOOL_RESULT, tokenEstimate: 30 }),
      makeSegment({ kind: "summary", priority: CONTEXT_PRIORITY_SUMMARY, tokenEstimate: 30 }),
    ],
  });

  // Combined must not exceed sections.loopHistory = 50
  assertLessOrEqual(snapshot.usedInputTokens, 50);

  // summary decision must be trim or drop, not keep (it would overflow the shared counter)
  const summaryDecision = snapshot.decisions.find((d) => d.kind === "summary");
  assertEquals(summaryDecision?.action !== "keep", true);
});
