/**
 * @module OpenRouterCacheControl
 * @path packages/ai-openrouter/src/openrouter_cache_control.ts
 * @description Marks the initial prompt for caching without changing replayed messages.
 * @architectural-layer AI
 * @dependencies [@exaix/ai]
 * @related-files [packages/ai-openrouter/src/openrouter_provider.ts]
 */
import type { OpenAiChatMessage } from "@exaix/ai/provider_common_utils.ts";
import { OPENROUTER_EXPLICIT_CACHE_MODELS, OPENROUTER_EXPLICIT_CACHE_PREFIXES } from "./constants.ts";

/** OpenRouter extends the user message with an explicit cache breakpoint on a text part. */
export type IOpenRouterChatMessage = OpenAiChatMessage | {
  role: "user";
  content: Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }>;
};

/** True when the prompt-caching guide documents explicit breakpoints for the model. */
function hasExplicitCache(model: string): boolean {
  return OPENROUTER_EXPLICIT_CACHE_PREFIXES.some((prefix) => model.startsWith(prefix)) ||
    (OPENROUTER_EXPLICIT_CACHE_MODELS as readonly string[]).includes(model);
}

/** Adds one breakpoint to a leading user prompt of a model the guide documents for explicit caching. */
export function applyCacheControl(
  messages: OpenAiChatMessage[],
  model: string,
  enabled: boolean,
): IOpenRouterChatMessage[] {
  const first = messages[0];
  if (!enabled || first?.role !== "user" || !hasExplicitCache(model)) return messages;
  return [
    { ...first, content: [{ type: "text", text: first.content, cache_control: { type: "ephemeral" } }] },
    ...messages.slice(1),
  ];
}
