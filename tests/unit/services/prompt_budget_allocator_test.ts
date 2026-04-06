/**
 * @module PromptBudgetAllocatorTest
 * @path tests/unit/services/prompt_budget_allocator_test.ts
 * @description Tests for Phase 62 Step 62.2 PromptBudgetAllocator service.
 * @architectural-layer Test
 * @related-files [src/services/context/prompt_budget_allocator.ts, src/shared/schemas/prompt_budget.ts]
 */

import { assertEquals, assertGreater } from "@std/assert";
import { PromptBudgetAllocator } from "../../../src/services/context/prompt_budget_allocator.ts";
import { MODEL_CONTEXT_WINDOWS, SECTION_BASE_WEIGHTS, SECTION_FLOORS } from "../../../src/shared/constants.ts";

// ============================================================================
// Test 1: Base allocation respects model windows and safety buffer
// ============================================================================

Deno.test("[PromptBudgetAllocator] allocates budgets respecting model context window", () => {
  const allocator = new PromptBudgetAllocator();
  const budget = allocator.allocate("openai:gpt-4o-mini");

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

Deno.test("[PromptBudgetAllocator] enforces SECTION_FLOORS for system and plan", () => {
  const allocator = new PromptBudgetAllocator();
  const budget = allocator.allocate("openai:gpt-4o-mini");

  // System and Plan must meet floor requirements
  assertGreater(budget.sections.system, SECTION_FLOORS.system - 1);
  assertGreater(budget.sections.plan, SECTION_FLOORS.plan - 1);
});

// ============================================================================
// Test 3: Waterfall reallocation shifts surplus from empty sections
// ============================================================================

Deno.test("[PromptBudgetAllocator] reallocates surplus from empty memory/skills to plan", () => {
  const allocator = new PromptBudgetAllocator();

  // Signal that memory and skills are empty (0 tokens used)
  const budget = allocator.allocate("openai:gpt-4o-mini", {
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

Deno.test("[PromptBudgetAllocator] applies base weights to allocate sections", () => {
  const allocator = new PromptBudgetAllocator();
  const budget = allocator.allocate("openai:gpt-4o-mini");

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

Deno.test("[PromptBudgetAllocator] falls back to default for unknown model", () => {
  const allocator = new PromptBudgetAllocator();
  const budget = allocator.allocate("unknown:model");

  // Should return a valid budget (fallback to a known model or default)
  assertEquals(budget.model, "unknown:model");
  assertGreater(budget.totalBudgetTokens, 0);
  assertGreater(budget.sections.plan, 0);
});
