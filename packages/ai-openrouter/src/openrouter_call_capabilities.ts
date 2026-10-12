/**
 * @module OpenRouterCallCapabilities
 * @path packages/ai-openrouter/src/openrouter_call_capabilities.ts
 * @description Declares the call capabilities of one OpenRouter model for the call projection and the tool_choice.
 * @architectural-layer AI
 * @dependencies [@exaix/ai, @exaix/schemas]
 * @related-files [packages/ai-openrouter/src/openrouter_provider.ts, packages/execution/src/strategies/react_loop_strategy.ts]
 */
import type { IProviderCallCapabilities } from "@exaix/ai";
import { EffortTierSchema } from "@exaix/schemas";
import { OPENROUTER_QWEN_MODEL_PREFIX, PROVIDER_OPENROUTER } from "./constants.ts";

/** Declares every effort tier, so the projection passes effort through. Per-model reasoning is gated in the request body. */
export function openrouterCallCapabilities(model: string): IProviderCallCapabilities {
  const qwen = model.startsWith(OPENROUTER_QWEN_MODEL_PREFIX);
  return Object.freeze({
    profile: PROVIDER_OPENROUTER,
    supportsThinking: true,
    supportedEffortTiers: Object.freeze([...EffortTierSchema.options]),
    ...(qwen ? { supportsAnyToolChoice: false, supportsForcedToolChoiceWithThinking: false } : {}),
  });
}
