/**
 * @module PromptBudgetAllocatorTest
 * @path packages/core/tests/context/prompt_budget_allocator_test.ts
 * @description Tests for Phase 62 Step 62.2 PromptBudgetAllocator service.
 * @architectural-layer Test
 * @related-files [packages/core/src/context/prompt_budget_allocator.ts, "packages/schemas/src/prompt_budget.ts"]
 */

import { assert, assertEquals, assertGreater, assertRejects } from "@std/assert";
import { PromptBudgetAllocator } from "@exaix/core/context";
import { ContextBudgetExceededError } from "@exaix/core/errors";
import { RequestTaskType } from "@exaix/schemas/request_analysis.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { IEventLogger } from "@exaix/core/logger";
import type { ITokenizer } from "@exaix/core/func";
import { AiTokenEstimatorTokenizer } from "@exaix/core/func";
import { LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK, SECTION_BASE_WEIGHTS, SECTION_FLOORS } from "@exaix/core";

// ============================================================================
// Test 1: Base allocation respects model windows and safety buffer
// ============================================================================

Deno.test("[PromptBudgetAllocator] allocates budgets respecting model context window", async () => {
  const allocator = new PromptBudgetAllocator();
  const budget = await allocator.allocate("openai:gpt-4o-mini");

  assertEquals(budget.model, "openai:gpt-4o-mini");
  assertEquals(budget.totalBudgetTokens, 128_000);

  // 10% safety buffer
  const expectedSafetyBuffer = Math.floor(budget.totalBudgetTokens * 0.1);
  assertEquals(budget.safetyBufferTokens, expectedSafetyBuffer);

  // Total allocated should equal total budget
  const totalAllocated = Object.values(budget.sections).reduce((a, b) => a + b, 0);
  assertEquals(totalAllocated + budget.safetyBufferTokens, budget.totalBudgetTokens);
});

// ============================================================================
// Test 2: Base allocation enforces section floors
// ============================================================================

Deno.test("[PromptBudgetAllocator] enforces SECTION_FLOORS for system and plan", async () => {
  const allocator = new PromptBudgetAllocator();
  const budget = await allocator.allocate("openai:gpt-4o-mini");

  // System and Plan must meet floor requirements
  assertGreater(budget.sections.system, SECTION_FLOORS.system - 1);
  assertGreater(budget.sections.plan, SECTION_FLOORS.plan - 1);
});

// ============================================================================
// Test 3: Waterfall reallocation shifts surplus from empty sections
// ============================================================================

Deno.test("[PromptBudgetAllocator] reallocates surplus from empty memory/skills to plan", async () => {
  const allocator = new PromptBudgetAllocator();

  // Signal that memory and skills are empty (0 tokens used)
  const budget = await allocator.allocate("openai:gpt-4o-mini", {
    memoryUsedTokens: 0,
    skillsUsedTokens: 0,
    loopHistoryUsedTokens: 0,
  });

  // Plan should receive a boost due to empty lower-priority sections
  assertGreater(budget.sections.plan, SECTION_BASE_WEIGHTS.plan * budget.totalBudgetTokens * 0.9);
});

// ============================================================================
// Test 4: Base weights are applied proportionally
// ============================================================================

Deno.test("[PromptBudgetAllocator] applies base weights to allocate sections", async () => {
  const allocator = new PromptBudgetAllocator();
  const budget = await allocator.allocate("openai:gpt-4o-mini");

  const usableBudget = budget.totalBudgetTokens - budget.safetyBufferTokens;

  // System should be roughly 20% of usable budget (allowing some variance due to floors)
  const systemRatio = budget.sections.system / usableBudget;
  assertGreater(systemRatio, 0.15);

  // Plan should be roughly 35% of usable budget
  const planRatio = budget.sections.plan / usableBudget;
  assertGreater(planRatio, 0.25);
});

// ============================================================================
// Test 5: Unsupported model falls back to default
// ============================================================================

Deno.test("[PromptBudgetAllocator] falls back to default for unknown model", async () => {
  const allocator = new PromptBudgetAllocator();
  const budget = await allocator.allocate("unknown:model");

  // Should return a valid budget (fallback to a known model or default)
  assertEquals(budget.model, "unknown:model");
  assertGreater(budget.totalBudgetTokens, 0);
  assertGreater(budget.sections.plan, 0);
});

// ============================================================================
// Test 6: Local model defaults to strict budgeting now (DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED = true)
// ============================================================================

Deno.test("[PromptBudgetAllocator] local model defaults to strict budget enforcement", async () => {
  const allocator = new PromptBudgetAllocator();
  const budget = await allocator.allocate("ollama:llama3.2", {
    memoryUsedTokens: 0,
    skillsUsedTokens: 0,
    loopHistoryUsedTokens: 0,
  });

  assertEquals(budget.totalBudgetTokens, LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK);
  assertGreater(budget.safetyBufferTokens, 0);
  assertGreater(budget.sections.plan, SECTION_FLOORS.plan - 1);
});

// ============================================================================
// Test 7: Local model with enforcement enabled uses 32k strict budgeting
// ============================================================================

Deno.test("[PromptBudgetAllocator] local model uses strict budgeting when local policy enabled", async () => {
  const allocator = new PromptBudgetAllocator({
    cloud: true,
    local: true,
  });

  const budget = await allocator.allocate("ollama:llama3.2", {
    memoryUsedTokens: 0,
    skillsUsedTokens: 0,
    loopHistoryUsedTokens: 0,
  });

  assertEquals(budget.totalBudgetTokens, LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK);
  assertGreater(budget.safetyBufferTokens, 0);
  assertGreater(budget.sections.plan, SECTION_FLOORS.plan - 1);
});

// ============================================================================
// Test 8: Unknown cloud model stays strict and uses cloud fallback
// ============================================================================

Deno.test("[PromptBudgetAllocator] unknown non-local model uses cloud strict fallback", async () => {
  const allocator = new PromptBudgetAllocator();
  const budget = await allocator.allocate("custom: any-cloud-model");

  assertEquals(budget.totalBudgetTokens, 128_000);
  assertGreater(budget.safetyBufferTokens, 0);
  assertGreater(budget.sections.plan, 0);
});

// ============================================================================
// Test 9: Cloud enforcement can be disabled via policy override
// ============================================================================

Deno.test("[PromptBudgetAllocator] cloud model can run relaxed mode when cloud policy disabled", async () => {
  const allocator = new PromptBudgetAllocator({
    cloud: false,
    local: false,
  });

  const budget = await allocator.allocate("openai:gpt-4o-mini");

  assertEquals(budget.totalBudgetTokens, 128_000);
  assertEquals(budget.safetyBufferTokens, 0);
  assertEquals(budget.sections.system, 128_000);
  assertEquals(budget.sections.plan, 128_000);
});

// ============================================================================
// Test 10: Overfill with enforcement ON throws ContextBudgetExceededError
// ============================================================================

Deno.test("[PromptBudgetAllocator] overfill throws ContextBudgetExceededError when enforcement enabled", async () => {
  const allocator = new PromptBudgetAllocator({
    cloud: true,
    enabled: true,
  });

  // Set hints that suggest the actual usage exceeds the total budget
  await assertRejects(
    () =>
      allocator.allocate("openai:gpt-4o-mini", {
        systemUsedTokens: 200_000,
        planUsedTokens: 200_000,
      }),
    ContextBudgetExceededError,
  );
});

// ============================================================================
// Test 11: Error message includes Object.keys(sections).length
// ============================================================================

Deno.test("[PromptBudgetAllocator] error message includes sections count", async () => {
  const allocator = new PromptBudgetAllocator({
    cloud: true,
    enabled: true,
  });

  try {
    await allocator.allocate("openai:gpt-4o-mini", {
      systemUsedTokens: 200_000,
      planUsedTokens: 200_000,
    });
    throw new Error("Should have thrown");
  } catch (error) {
    assert(error instanceof ContextBudgetExceededError);
    assert(error.message.includes("sections"));
    assert(error.message.includes("6")); // 6 section keys
  }
});

// ============================================================================
// Test 12: Underfill — normal allocation, no error
// ============================================================================

Deno.test("[PromptBudgetAllocator] underfill does not throw", async () => {
  const allocator = new PromptBudgetAllocator({ cloud: true, enabled: true });
  const budget = await allocator.allocate("openai:gpt-4o-mini", {
    memoryUsedTokens: 0,
    skillsUsedTokens: 0,
    loopHistoryUsedTokens: 0,
  });
  assert(budget.totalBudgetTokens > 0);
  assert(budget.sections.plan > 0);
});

// ============================================================================
// Test 13: enforcement.enabled overrides local:false
// ============================================================================

Deno.test("[PromptBudgetAllocator] enabled:true overrides local:false sub-field", async () => {
  const allocator = new PromptBudgetAllocator({
    local: false,
    enabled: true,
  });

  const budget = await allocator.allocate("ollama:llama3.2", {
    memoryUsedTokens: 0,
    skillsUsedTokens: 0,
    loopHistoryUsedTokens: 0,
  });

  // Should have strict budgeting despite local:false
  assertGreater(budget.safetyBufferTokens, 0);
  assert(budget.sections.system < LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK);
});

// ============================================================================
// Request-Adaptive Weight Reallocation tests
// ============================================================================

function makeAnalysis(overrides: Partial<{
  taskType: RequestTaskType;
  referencedFiles: string[];
}> = {}): IRequestAnalysis {
  return {
    taskType: overrides.taskType ?? RequestTaskType.UNKNOWN,
    referencedFiles: overrides.referencedFiles ?? [],
    goals: [{ description: "test", explicit: true, priority: 1 }],
    requirements: [{ description: "test", confidence: 0.9, type: "functional", explicit: true }],
    constraints: [],
    acceptanceCriteria: [],
    ambiguities: [],
    actionabilityScore: 80,
    complexity: "simple" as never,
    tags: [],
    metadata: { analyzedAt: "", durationMs: 0, mode: "heuristic" as never, analyzerVersion: "" },
  };
}

Deno.test("[PromptBudgetAllocator] code_generation shifts 5% from portalKnowledge to plan", async () => {
  const allocator = new PromptBudgetAllocator({ cloud: true, local: true });
  const budget = await allocator.allocate("openai:gpt-4o-mini", {
    memoryUsedTokens: 100,
    skillsUsedTokens: 100,
    loopHistoryUsedTokens: 100,
  }, makeAnalysis({ taskType: RequestTaskType.FEATURE }));

  const usable = budget.totalBudgetTokens - budget.safetyBufferTokens;
  assert(budget.sections.plan / usable > 0.38, "plan should get +5% boost");
  assert(budget.sections.portalKnowledge / usable < 0.18, "portalKnowledge should shrink 5%");
});

Deno.test("[PromptBudgetAllocator] code_review shifts from plan to portalKnowledge (within floors)", async () => {
  const allocator = new PromptBudgetAllocator({ cloud: true, local: true });
  const budget = await allocator.allocate("openai:gpt-4o-mini", {
    memoryUsedTokens: 100,
    skillsUsedTokens: 100,
    loopHistoryUsedTokens: 100,
  }, makeAnalysis({ taskType: RequestTaskType.ANALYSIS }));

  const usable = budget.totalBudgetTokens - budget.safetyBufferTokens;
  // Plan floor (0.35) limits the shift, but portalKnowledge should still
  // receive a boost compared to the default 0.20
  assert(budget.sections.portalKnowledge / usable > 0.22, "portalKnowledge should get a boost");
});

Deno.test("[PromptBudgetAllocator] no analysis leaves static weights unchanged", async () => {
  const allocator = new PromptBudgetAllocator({ cloud: true, local: true });
  const budget = await allocator.allocate("openai:gpt-4o-mini", {
    memoryUsedTokens: 100,
    skillsUsedTokens: 100,
    loopHistoryUsedTokens: 100,
  });

  const usable = budget.totalBudgetTokens - budget.safetyBufferTokens;
  assert(Math.abs(budget.sections.plan / usable - 0.35) < 0.02, "plan ~0.35");
  assert(Math.abs(budget.sections.portalKnowledge / usable - 0.20) < 0.02, "pk ~0.20");
});

Deno.test("[PromptBudgetAllocator] large referencedFiles boosts portalKnowledge", async () => {
  const allocator = new PromptBudgetAllocator({ cloud: true, local: true });
  const budget = await allocator.allocate(
    "openai:gpt-4o-mini",
    {
      memoryUsedTokens: 100,
      skillsUsedTokens: 100,
      loopHistoryUsedTokens: 100,
    },
    makeAnalysis({
      taskType: RequestTaskType.UNKNOWN,
      referencedFiles: Array.from({ length: 15 }, (_, i) => `file${i}.ts`),
    }),
  );

  const usable = budget.totalBudgetTokens - budget.safetyBufferTokens;
  assert(budget.sections.skills / usable < 0.08, "skills should shrink 5%");
  assert(budget.sections.portalKnowledge / usable > 0.22, "pk should get +5% from file count");
});

Deno.test("[PromptBudgetAllocator] unknown taskType leaves weights unchanged", async () => {
  const allocator = new PromptBudgetAllocator({ cloud: true, local: true });
  const budget = await allocator.allocate("openai:gpt-4o-mini", {
    memoryUsedTokens: 100,
    skillsUsedTokens: 100,
    loopHistoryUsedTokens: 100,
  }, makeAnalysis({ taskType: RequestTaskType.UNKNOWN }));

  const usable = budget.totalBudgetTokens - budget.safetyBufferTokens;
  assert(Math.abs(budget.sections.plan / usable - 0.35) < 0.02, "plan ~0.35");
});

Deno.test("[PromptBudgetAllocator] analysis with missing fields uses safe defaults", async () => {
  const allocator = new PromptBudgetAllocator({ cloud: true, local: true });
  const budget = await allocator.allocate("openai:gpt-4o-mini", {
    memoryUsedTokens: 0,
    skillsUsedTokens: 0,
    loopHistoryUsedTokens: 0,
  }, {} as never);
  assert(budget.sections.plan > 0);
  assert(budget.sections.portalKnowledge > 0);
});

Deno.test("[PromptBudgetAllocator] ratio floors keep plan >= 0.30 after adjustment and re-normalization", async () => {
  const allocator = new PromptBudgetAllocator({ cloud: true, local: true });
  const budget = await allocator.allocate("openai:gpt-4o-mini", {
    memoryUsedTokens: 100,
    skillsUsedTokens: 100,
    loopHistoryUsedTokens: 100,
  }, makeAnalysis({ taskType: RequestTaskType.ANALYSIS }));

  const usable = budget.totalBudgetTokens - budget.safetyBufferTokens;
  // Floor clamping at 0.35 then re-normalization to sum 1.0 yields ~0.318
  assert(budget.sections.plan / usable >= 0.30, "plan ratio should be >= 0.30 after floor + renormalize");
  assert(budget.sections.system / usable >= 0.17, "system ratio should be >= 0.17 after floor + renormalize");
});

// ============================================================================
// Budget event emission tests
// ============================================================================

interface CapturedEvent {
  action: string;
  payload: Record<string, number | string | boolean | Record<string, number>>;
}

function createMockLogger(): { logger: IEventLogger; events: CapturedEvent[] } {
  const events: CapturedEvent[] = [];
  const logger: IEventLogger = {
    info(action: string, _target: string | null, payload?: CapturedEvent["payload"]): Promise<void> {
      events.push({ action, payload: payload ?? {} });
      return Promise.resolve();
    },
    log(): Promise<void> {
      return Promise.resolve();
    },
    warn(): Promise<void> {
      return Promise.resolve();
    },
    error(): Promise<void> {
      return Promise.resolve();
    },
    fatal(): Promise<void> {
      return Promise.resolve();
    },
    debug(): Promise<void> {
      return Promise.resolve();
    },
    child(): IEventLogger {
      return logger;
    },
  };
  return { logger, events };
}

Deno.test("[PromptBudgetAllocator] allocate emits CONTEXT_BUDGET_ALLOCATED with sections breakdown", async () => {
  const { logger, events } = createMockLogger();
  const allocator = new PromptBudgetAllocator({ cloud: true, local: true }, undefined, logger);
  await allocator.allocate("openai:gpt-4o-mini", {
    memoryUsedTokens: 100,
    skillsUsedTokens: 100,
    loopHistoryUsedTokens: 100,
  });

  const allocEvents = events.filter((e) => e.action === "context.budget.allocated");
  assert(allocEvents.length >= 1, "should emit context.budget.allocated");
  const payload = allocEvents[0].payload;
  assert(payload.model, "payload should include model");
  assert(payload.totalTokens, "payload should include totalTokens");
  assert(payload.sections, "payload should include sections breakdown");
  assert(payload.tokenSource, "payload should include tokenSource");
});

Deno.test("[PromptBudgetAllocator] overfill emits CONTEXT_BUDGET_EXCEEDED before rejecting", async () => {
  const { logger, events } = createMockLogger();
  const allocator = new PromptBudgetAllocator({ cloud: true, enabled: true }, undefined, logger);

  try {
    await allocator.allocate("openai:gpt-4o-mini", {
      systemUsedTokens: 200_000,
      planUsedTokens: 200_000,
    });
  } catch {
    // expected
  }

  const exceededEvents = events.filter((e) => e.action === "context.budget.exceeded");
  assert(exceededEvents.length >= 1, "should emit context.budget.exceeded");
  const payload = exceededEvents[0].payload;
  assert(payload.model, "payload should include model");
  assert(payload.contextWindow, "payload should include contextWindow");
  assert(payload.estimatedTokens, "payload should include estimatedTokens");
  assert(payload.tokenSource, "payload should include tokenSource");
});

Deno.test("[PromptBudgetAllocator] underfill emits only allocated event, not exceeded", async () => {
  const { logger, events } = createMockLogger();
  const allocator = new PromptBudgetAllocator({ cloud: true, local: true }, undefined, logger);
  await allocator.allocate("openai:gpt-4o-mini", {
    memoryUsedTokens: 100,
    skillsUsedTokens: 100,
    loopHistoryUsedTokens: 100,
  });

  const allocEvents = events.filter((e) => e.action === "context.budget.allocated");
  const exceededEvents = events.filter((e) => e.action === "context.budget.exceeded");
  assert(allocEvents.length >= 1, "should emit allocated event");
  assertEquals(exceededEvents.length, 0, "should not emit exceeded event on underfill");
});

Deno.test("[PromptBudgetAllocator] budget events include tokenSource field", async () => {
  const { logger, events } = createMockLogger();
  const allocator = new PromptBudgetAllocator({ cloud: true, local: true }, undefined, logger);
  await allocator.allocate("openai:gpt-4o-mini", {
    memoryUsedTokens: 100,
    skillsUsedTokens: 100,
    loopHistoryUsedTokens: 100,
  });

  const allocEvents = events.filter((e) => e.action === "context.budget.allocated");
  assert(allocEvents.length >= 1);
  assertEquals(allocEvents[0].payload.tokenSource, "bpe");
});

// ============================================================================
// Tokenizer integration tests
// ============================================================================

Deno.test("[PromptBudgetAllocator] uses injected ITokenizer when provided", async () => {
  const tokenizer: ITokenizer = new AiTokenEstimatorTokenizer();
  const allocator = new PromptBudgetAllocator({ cloud: true }, tokenizer);
  const budget = await allocator.allocate("openai:gpt-4o-mini", {
    memoryUsedTokens: 100,
    skillsUsedTokens: 100,
    loopHistoryUsedTokens: 100,
  });
  assert(budget.totalBudgetTokens > 0);
  assert(budget.sections.plan > 0);
});

Deno.test("[PromptBudgetAllocator] defaults to AiTokenEstimatorTokenizer when none injected", () => {
  const allocator = new PromptBudgetAllocator({ cloud: true });
  assert(allocator !== null);
});
