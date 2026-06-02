/**
 * @module ContextBudgetConstantsTest
 * @path packages/core/tests/context_budget_constants_test.ts
 * @description Validates context budget overhead and segment priority constants.
 * @architectural-layer Tests
 * @related-files ["packages/core/src/types/constants.ts"]
 */

import { assertEquals, assertGreater } from "@std/assert";
import {
  CONTEXT_BUDGET_OVERHEAD_TARGET_MS,
  CONTEXT_PRIORITY_ACCEPTANCE_CRITERIA,
  CONTEXT_PRIORITY_PLAN_STEP,
  CONTEXT_PRIORITY_PORTAL_KNOWLEDGE,
  CONTEXT_PRIORITY_REFLECTION,
  CONTEXT_PRIORITY_REQUEST,
  CONTEXT_PRIORITY_SUMMARY,
  CONTEXT_PRIORITY_SYSTEM,
  CONTEXT_PRIORITY_TOOL_RESULT,
  REACT_TOOL_RESULT_BUDGET_RATIO,
} from "@exaix/core";

Deno.test("[ContextBudgetConstants] CONTEXT_BUDGET_OVERHEAD_TARGET_MS equals 15", () => {
  assertEquals(CONTEXT_BUDGET_OVERHEAD_TARGET_MS, 15);
});

Deno.test("[ContextBudgetConstants] REACT_TOOL_RESULT_BUDGET_RATIO equals 0.6", () => {
  assertEquals(REACT_TOOL_RESULT_BUDGET_RATIO, 0.6);
});

Deno.test("[ContextBudgetConstants] CONTEXT_PRIORITY_SYSTEM > CONTEXT_PRIORITY_TOOL_RESULT", () => {
  assertGreater(CONTEXT_PRIORITY_SYSTEM, CONTEXT_PRIORITY_TOOL_RESULT);
});

Deno.test("[ContextBudgetConstants] all CONTEXT_PRIORITY_* values are integers in range 0-100", () => {
  const priorities = [
    CONTEXT_PRIORITY_SYSTEM,
    CONTEXT_PRIORITY_ACCEPTANCE_CRITERIA,
    CONTEXT_PRIORITY_PLAN_STEP,
    CONTEXT_PRIORITY_REQUEST,
    CONTEXT_PRIORITY_PORTAL_KNOWLEDGE,
    CONTEXT_PRIORITY_REFLECTION,
    CONTEXT_PRIORITY_TOOL_RESULT,
    CONTEXT_PRIORITY_SUMMARY,
  ];
  for (const p of priorities) {
    assertEquals(Number.isInteger(p), true);
    assertGreater(p, -1);
    assertGreater(101, p);
  }
});

Deno.test("[ContextBudgetConstants] priority ordering is correct (system > criteria > plan > request > portal > reflection > tool > summary)", () => {
  assertGreater(CONTEXT_PRIORITY_SYSTEM, CONTEXT_PRIORITY_ACCEPTANCE_CRITERIA);
  assertGreater(CONTEXT_PRIORITY_ACCEPTANCE_CRITERIA, CONTEXT_PRIORITY_PLAN_STEP);
  assertGreater(CONTEXT_PRIORITY_PLAN_STEP, CONTEXT_PRIORITY_REQUEST);
  assertGreater(CONTEXT_PRIORITY_REQUEST, CONTEXT_PRIORITY_PORTAL_KNOWLEDGE);
  assertGreater(CONTEXT_PRIORITY_PORTAL_KNOWLEDGE, CONTEXT_PRIORITY_REFLECTION);
  assertGreater(CONTEXT_PRIORITY_REFLECTION, CONTEXT_PRIORITY_TOOL_RESULT);
  assertGreater(CONTEXT_PRIORITY_TOOL_RESULT, CONTEXT_PRIORITY_SUMMARY);
});
