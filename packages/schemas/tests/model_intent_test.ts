/**
 * @module ModelIntentTest
 * @path packages/schemas/tests/model_intent_test.ts
 * @description Phase 132 Step 1 — validates ModelIntent, IResolvedModel, and ModelResolutionReason type shapes.
 */
import { assertEquals } from "@std/assert";
import type {
  EffortTier,
  IModelCallOptions,
  IResolvedModel,
  ModelIntent,
  ModelResolutionReason,
  ModelSize,
} from "../src/model_intent.ts";

Deno.test("[step132.1] ModelIntent type accepts all fields", () => {
  const intent: ModelIntent = {
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
    model: "claude-sonnet-4-20250514",
    options: { thinking: true, effort: "medium", max_tokens: 4096 } as IModelCallOptions,
    attempt: 1,
  };

  assertEquals(resolved.provider, "anthropic");
  assertEquals(resolved.model, "claude-sonnet-4-20250514");
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
