/**
 * @module OpenRouterReportedCost
 * @path packages/ai-openrouter/src/openrouter_reported_cost.ts
 * @description Phase 135 Step 2 (F6/G9) — a dedicated OpenRouter token mapper that
 *   reads the authoritative usage.cost from the response (returned when the request
 *   carries usage:{include:true}) instead of the internal blended calculateCost
 *   estimate. cost_usd is left undefined when the response omits usage.cost.
 * @architectural-layer AI-OpenRouter
 * @dependencies [@exaix/ai/provider_common_utils]
 * @related-files [packages/ai-openrouter/src/openrouter_provider.ts, packages/core/src/cost/cost_tracker.ts]
 */
import type { OpenAIResponse, TokenMap } from "@exaix/ai";

/** OpenRouter usage block — OpenAI-shaped plus the reported `cost` (usage accounting). */
export interface IOpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  /** USD cost OpenRouter reports when usage:{include:true} was requested. */
  cost?: number;
  /** OpenRouter is an OpenAI-compatible gateway that passes an upstream reasoning model's
   *  (o1/o3/gpt-5, gemini-thinking, etc.) reasoning-token breakdown through verbatim. A
   *  SUBSET of completion_tokens (billed as output, not additional). */
  completion_tokens_details?: { reasoning_tokens?: number };
}

/** OpenRouter response — the OpenAI shape (choices/…) with the cost-carrying usage. */
export interface IOpenRouterResponse extends Omit<OpenAIResponse, "usage"> {
  usage?: IOpenRouterUsage;
}

/**
 * Build a token mapper that captures OpenRouter's reported usage.cost verbatim.
 * When usage.cost is absent, cost_usd stays undefined (no blended fallback here —
 * the tracker's legacy path handles unpriced records).
 */
export function tokenMapperOpenRouter(
  model: string,
): (d: IOpenRouterResponse) => TokenMap | undefined {
  return (d: IOpenRouterResponse): TokenMap | undefined => {
    if (!d.usage) return undefined;
    const totalTokens = d.usage.total_tokens ??
      (d.usage.prompt_tokens + d.usage.completion_tokens);
    return {
      prompt_tokens: d.usage.prompt_tokens,
      completion_tokens: d.usage.completion_tokens,
      total_tokens: totalTokens,
      model,
      cost_usd: typeof d.usage.cost === "number" ? d.usage.cost : undefined,
      reasoning_tokens: d.usage.completion_tokens_details?.reasoning_tokens,
    };
  };
}
