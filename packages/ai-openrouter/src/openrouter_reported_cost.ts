/**
 * @module OpenRouterReportedCost
 * @path packages/ai-openrouter/src/openrouter_reported_cost.ts
 * @description Phase 135 Step 2 (F6/G9) — a dedicated OpenRouter token mapper that
 *   reads the authoritative usage.cost from the response (returned when the request
 *   carries usage:{include:true}) instead of the internal blended calculateCost
 *   estimate. cost_usd is left undefined when the response omits usage.cost. The usage guide
 *   states that cost is in credits. The shared TokenMap field keeps its name for now.
 * @architectural-layer AI-OpenRouter
 * @dependencies [@exaix/ai/provider_common_utils]
 * @related-files [packages/ai-openrouter/src/openrouter_provider.ts, packages/core/src/cost/cost_tracker.ts]
 */
import type { OpenAIResponse, TokenMap } from "@exaix/ai";
import { OPENROUTER_MODEL_ID_MAX_CHARS } from "./constants.ts";
import { cleanUpstreamText } from "./openrouter_upstream_text.ts";

/** OpenRouter usage block — OpenAI-shaped plus the reported `cost` (usage accounting). */
interface IOpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  /** Cost that OpenRouter reports on every response, in OpenRouter credits. */
  cost?: number;
  is_byok?: boolean;
  /** Cache read and write counts. Both are subsets of prompt_tokens. */
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
    audio_tokens?: number;
    video_tokens?: number;
  };
  cost_details?: {
    /** What the upstream provider charged. Under BYOK it is the only cost. */
    upstream_inference_cost?: number;
    upstream_inference_prompt_cost?: number;
    upstream_inference_completions_cost?: number;
  };
  /** Savings from prompt caching. Present only when a cache was used. */
  cache_discount?: number;
  /** OpenRouter is an OpenAI-compatible gateway that passes an upstream reasoning model's
   *  (o1/o3/gpt-5, gemini-thinking, etc.) reasoning-token breakdown through verbatim. A
   *  SUBSET of completion_tokens (billed as output, not additional). */
  completion_tokens_details?: { reasoning_tokens?: number; image_tokens?: number; audio_tokens?: number };
}

/** One OpenRouter choice: the OpenAI shape plus the finish reasons that the OpenAI type omits. */
type IOpenRouterChoice = NonNullable<OpenAIResponse["choices"]>[number] & {
  finish_reason?: string | null;
  native_finish_reason?: string | null;
};

/** OpenRouter response — the OpenAI shape (choices/…) with the cost-carrying usage. */
export interface IOpenRouterResponse extends Omit<Omit<OpenAIResponse, "usage">, "choices"> {
  usage?: IOpenRouterUsage;
  choices?: IOpenRouterChoice[];
}

/** The reported cost in OpenRouter credits, or undefined when the response omits it. No estimate is made. */
export function reportedCostCredits(usage: IOpenRouterUsage): number | undefined {
  return typeof usage.cost === "number" ? usage.cost : undefined;
}

/** Maps reported usage cost without estimating a fallback when it is absent. */
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
      model: cleanUpstreamText(d.model, OPENROUTER_MODEL_ID_MAX_CHARS) ?? model,
      cost_usd: reportedCostCredits(d.usage),
      reasoning_tokens: d.usage.completion_tokens_details?.reasoning_tokens,
      cache_read_tokens: d.usage.prompt_tokens_details?.cached_tokens,
      cache_creation_tokens: d.usage.prompt_tokens_details?.cache_write_tokens,
      upstream_inference_cost: d.usage.cost_details?.upstream_inference_cost,
      cache_discount: d.usage.cache_discount,
    };
  };
}
