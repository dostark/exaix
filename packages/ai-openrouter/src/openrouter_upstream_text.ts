/**
 * @module OpenRouterUpstreamText
 * @path packages/ai-openrouter/src/openrouter_upstream_text.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_errors.ts", "packages/ai-openrouter/src/openrouter_reported_cost.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/core"]
 * @description One cleaning rule for every OpenRouter response string that reaches a message, the journal or the console.
 * Control characters become spaces, the text is trimmed and the length is capped.
 */

import type { Opt, Reason } from "@exaix/core/types";

const CONTROL_CHARACTERS = /\p{Cc}/gu;

/** The text with control characters replaced by spaces, trimmed and capped. Undefined when nothing is left. */
export function cleanUpstreamText(
  value: Opt<string | number, Reason.OptionalInput>,
  maxChars: number,
): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = String(value).replace(CONTROL_CHARACTERS, " ").trim().slice(0, maxChars);
  return cleaned.length > 0 ? cleaned : undefined;
}
