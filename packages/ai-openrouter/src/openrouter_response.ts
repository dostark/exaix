/**
 * @module OpenRouterResponse
 * @path packages/ai-openrouter/src/openrouter_response.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts", "packages/ai-openrouter/src/openrouter_errors.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/ai", "@exaix/core"]
 * @description Content and finish-reason extraction for an OpenRouter response. A reply cut off at the token
 * limit with no content and no tool call becomes a typed truncation error, so the caller never mistakes it
 * for a model that said nothing. The shared OpenAI extractor stays unchanged.
 */

import { extractOpenAIContent } from "@exaix/ai/provider_common_utils.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { OPENROUTER_FINISH_REASON_LENGTH } from "./constants.ts";
import { OpenRouterTruncationError } from "./openrouter_errors.ts";
import type { IOpenRouterResponse } from "./openrouter_reported_cost.ts";

/** The reply text. Throws OpenRouterTruncationError for a length finish with no content and no tool call. */
export function extractOpenRouterContent(response: IOpenRouterResponse, providerId: string): string {
  const content = extractOpenAIContent(response);
  const choice = response.choices?.[0];
  const hasToolCalls = (choice?.message?.tool_calls?.length ?? 0) > 0;
  if (choice?.finish_reason === OPENROUTER_FINISH_REASON_LENGTH && content.trim() === "" && !hasToolCalls) {
    throw new OpenRouterTruncationError(
      providerId,
      response.usage?.completion_tokens,
      response.usage?.completion_tokens_details?.reasoning_tokens,
    );
  }
  return content;
}

/** Why generation ended, as OpenRouter reports it. Absent when the route does not say. */
export function extractOpenRouterFinishReason(response: IOpenRouterResponse): Opt<string, Reason.OptionalContext> {
  return response.choices?.[0]?.finish_reason ?? undefined;
}
