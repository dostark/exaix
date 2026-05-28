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
import {
  LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK,
  MODEL_CONTEXT_WINDOWS,
  SECTION_BASE_WEIGHTS,
  SECTION_FLOORS,
} from "@exaix/core";

// ============================================================================
// Test 1: Base allocation respects model windows and safety buffer
// ============================================================================

Deno.test("[PromptBudgetAllocator] allocates budgets respecting model context window", async () => {
  const allocator = new PromptBudgetAllocator();
  const budget = await allocator.allocate("openai:gpt-4o-mini");

  assertEquals(budget.model, "openai:gpt-4o-mini");
  assertEquals(budget.totalBudgetTokens, MODEL_CONTEXT_WINDOWS["openai:gpt-4o-mini"]);

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

  assertEquals(budget.totalBudgetTokens, MODEL_CONTEXT_WINDOWS["openai:gpt-4o-mini"]);
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

  assertEquals(budget.totalBudgetTokens, MODEL_CONTEXT_WINDOWS["openai:gpt-4o-mini"]);
  assertEquals(budget.safetyBufferTokens, 0);
  assertEquals(budget.sections.system, MODEL_CONTEXT_WINDOWS["openai:gpt-4o-mini"]);
  assertEquals(budget.sections.plan, MODEL_CONTEXT_WINDOWS["openai:gpt-4o-mini"]);
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
