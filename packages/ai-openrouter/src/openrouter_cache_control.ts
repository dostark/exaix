/**
 * @module OpenRouterCacheControl
 * @path packages/ai-openrouter/src/openrouter_cache_control.ts
 * @description Marks the initial prompt for caching without changing replayed messages.
 * @architectural-layer AI
 * @dependencies [@exaix/ai]
 * @related-files [packages/ai-openrouter/src/openrouter_provider.ts, packages/ai-openrouter/src/constants.ts]
 */
import type { OpenAiChatMessage } from "@exaix/ai/provider_common_utils.ts";
import { OPENROUTER_CACHE_CONTROL_FAMILIES } from "./constants.ts";

/** OpenRouter extends the user message with an explicit cache breakpoint on a text part. */
export type IOpenRouterChatMessage = OpenAiChatMessage | {
  role: "user";
  content: Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }>;
};

/** Adds one breakpoint to a leading user prompt. Leading replay messages remain unchanged. */
export function applyCacheControl(
  messages: OpenAiChatMessage[],
  model: string,
  enabled: boolean,
): IOpenRouterChatMessage[] {
  const first = messages[0];
  if (
    !enabled || first?.role !== "user" ||
    !Object.keys(OPENROUTER_CACHE_CONTROL_FAMILIES).some((prefix) => model.startsWith(prefix))
  ) return messages;
  return [
    { ...first, content: [{ type: "text", text: first.content, cache_control: { type: "ephemeral" } }] },
    ...messages.slice(1),
  ];
}
