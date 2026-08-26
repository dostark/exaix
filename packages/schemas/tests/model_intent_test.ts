/**
 * @module ModelIntentTest
 * @path packages/schemas/tests/model_intent_test.ts
 * @description Phase 132 Step 1 — validates IModelIntent, IResolvedModel, and ModelResolutionReason type shapes.
 */
import { assertEquals } from "@std/assert";
import { TaskType } from "@exaix/core";
import type {
  EffortTier,
  IModelCallOptions,
  IModelIntent,
  IResolvedModel,
  ModelResolutionReason,
  ModelSize,
} from "../src/model_intent.ts";
import { EffortTierSchema } from "../src/model_intent.ts";

Deno.test("[132.23][GAP-6] EffortTierSchema parses and round-trips all three effort tiers", () => {
  for (const tier of ["low", "medium", "high"] as const) {
    const parsed = EffortTierSchema.parse(tier);
    assertEquals(parsed, tier);
  }
});

Deno.test("[132.23][GAP-6] EffortTierSchema rejects out-of-range effort values", () => {
  let threw = false;
  try {
    EffortTierSchema.parse("turbo");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("[step132.1] IModelIntent type accepts all fields", () => {
  const intent: IModelIntent = {
    model: "provider:model-name",
    model_size: "M" as ModelSize,
    characteristics: ["cheapest", "fastest"],
    thinking: true,
    effort: "high" as EffortTier,
    required_capabilities: ["chat", "streaming"],
    max_cost_usd: 0.5,
    allow_local: false,
    preferred_provider: "anthropic",
    fallbacks: [{ model_size: "L" as ModelSize }],
    context_window_fallback: true,
  };

  assertEquals(intent.model, "provider:model-name");
  assertEquals(intent.model_size, "M");
  assertEquals(intent.characteristics!.length, 2);
  assertEquals(intent.thinking, true);
  assertEquals(intent.effort, "high");
  assertEquals(intent.required_capabilities, ["chat", "streaming"]);
  assertEquals(intent.max_cost_usd, 0.5);
  assertEquals(intent.allow_local, false);
  assertEquals(intent.preferred_provider, "anthropic");
  assertEquals(intent.fallbacks!.length, 1);
  assertEquals(intent.context_window_fallback, true);
});

Deno.test("[step132.1] IResolvedModel shape is correct", () => {
  const resolved: IResolvedModel = {
    provider: "anthropic",
    model: "claude-sonnet-5",
    options: { thinking: true, effort: "medium", max_tokens: 4096 } as IModelCallOptions,
    attempt: 1,
  };

  assertEquals(resolved.provider, "anthropic");
  assertEquals(resolved.model, "claude-sonnet-5");
  assertEquals(resolved.options!.thinking, true);
  assertEquals(resolved.options!.effort, "medium");
  assertEquals(resolved.options!.max_tokens, 4096);
  assertEquals(resolved.attempt, 1);
});

Deno.test("[step132.1] ModelResolutionReason values are strings", () => {
  const reasons: ModelResolutionReason[] = [
    "explicit_override",
    "characteristics_scored",
    "preset_default",
    "fallback",
    "thinking_constrained",
    "context_window_overflow",
  ];

  for (const reason of reasons) {
    assertEquals(typeof reason, "string");
  }
});

Deno.test("[step135.8] IModelIntent accepts an optional task_type field", () => {
  const intent: IModelIntent = { model_size: "M" as ModelSize, task_type: TaskType.FEATURE };
  assertEquals(intent.task_type, TaskType.FEATURE);
});

Deno.test("[step135.8] ModelResolutionReason includes best_ranked and usage_ranked", () => {
  const reasons: ModelResolutionReason[] = ["best_ranked", "usage_ranked"];
  for (const reason of reasons) {
    assertEquals(typeof reason, "string");
  }
});
