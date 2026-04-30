/**
 * @module PromptBudgetSchemaTest
 * @path tests/schemas/prompt_budget_schema_test.ts
 * @description RED-first tests for Phase 62 Step 62.1 prompt budget schema and constants foundation.
 * @architectural-layer Test
 * @related-files ["packages/schemas/src/prompt_budget.ts", "src/constants.ts"]
 */

import { assertEquals } from "@std/assert";
import {
  DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED,
  DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED,
  LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK,
  LOCAL_PROVIDER_PREFIXES,
  MODEL_CONTEXT_WINDOWS,
  MODEL_PRICING_MAP,
  SECTION_FLOORS,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
} from "@exaix/core";
import { PromptBudgetSection, ZBudgetPolicy, ZPromptBudget } from "@exaix/schemas/prompt_budget.ts";

Deno.test("[PromptBudgetSchema] validates a complete prompt budget", () => {
  const result = ZPromptBudget.safeParse({
    model: "openai:gpt-4o-mini",
    totalBudgetTokens: 120_000,
    safetyBufferTokens: 12_000,
    sections: {
      system: 20_000,
      plan: 35_000,
      portalKnowledge: 25_000,
      memory: 10_000,
      skills: 8_000,
      loopHistory: 22_000,
    },
  });

  assertEquals(result.success, true);
});

Deno.test("[PromptBudgetSchema] requires loopHistory section", () => {
  const result = ZPromptBudget.safeParse({
    model: "openai:gpt-4o-mini",
    totalBudgetTokens: 120_000,
    safetyBufferTokens: 12_000,
    sections: {
      system: 20_000,
      plan: 35_000,
      portalKnowledge: 25_000,
      memory: 10_000,
      skills: 8_000,
    },
  });

  assertEquals(result.success, false);
});

Deno.test("[PromptBudgetSchema] exports loopHistory section enum", () => {
  assertEquals(PromptBudgetSection.LOOP_HISTORY, "loopHistory");
});

Deno.test("[PromptBudgetConstants] exports model windows, pricing, and floors", () => {
  assertEquals(typeof MODEL_CONTEXT_WINDOWS, "object");
  assertEquals(typeof MODEL_PRICING_MAP, "object");
  assertEquals(typeof SECTION_FLOORS, "object");
  assertEquals(SECTION_FLOORS.system > 0, true);
  assertEquals(SECTION_FLOORS.plan > 0, true);
});

Deno.test("[PromptBudgetConstants] uses 4:1 chars-to-token heuristic", () => {
  assertEquals(TOKEN_ESTIMATION_CHARS_PER_TOKEN, 4);
});

Deno.test("[PromptBudgetConstants] exports local provider prefixes", () => {
  assertEquals(Array.isArray(LOCAL_PROVIDER_PREFIXES), true);
  assertEquals(LOCAL_PROVIDER_PREFIXES.includes("ollama:"), true);
  assertEquals(LOCAL_PROVIDER_PREFIXES.includes("lmstudio:"), true);
  assertEquals(LOCAL_PROVIDER_PREFIXES.includes("local:"), true);
});

Deno.test("[PromptBudgetConstants] exports local fallback context window", () => {
  assertEquals(LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK, 32_768);
});

Deno.test("[PromptBudgetConstants] exports cloud/local budget enforcement defaults", () => {
  assertEquals(DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED, true);
  assertEquals(DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED, false);
});

Deno.test("[PromptBudgetSchema] validates budget policy defaults", () => {
  const result = ZBudgetPolicy.safeParse({});

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.cloud, true);
    assertEquals(result.data.local, false);
  }
});

Deno.test("[PromptBudgetSchema] validates explicit budget policy overrides", () => {
  const result = ZBudgetPolicy.safeParse({
    cloud: false,
    local: true,
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.cloud, false);
    assertEquals(result.data.local, true);
  }
});
