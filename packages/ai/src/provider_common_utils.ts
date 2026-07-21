/**
 * @module ProviderUtils
 * @path packages/ai/src/provider_common_utils.ts
 * @description Shared utilities for AI providers, including token mapping, cost calculation, response handling, and retry logic.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers.ts]
 */
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";

import {
  AuthenticationError,
  ConnectionError,
  type IGenerateResult,
  ModelProviderError,
  RateLimitError,
  withRetry,
} from "./providers/common.ts";
import type { IModelOptions } from "./types.ts";
import { DEFAULT_AI_RETRY_BACKOFF_BASE_MS, DEFAULT_AI_RETRY_MAX_ATTEMPTS, PROVIDER_MOCK } from "@exaix/ai";
import {
  COST_RATE_ANTHROPIC,
  COST_RATE_GOOGLE,
  COST_RATE_MOCK,
  COST_RATE_OLLAMA,
  COST_RATE_OPENAI,
  PROVIDER_ANTHROPIC,
  PROVIDER_EVENT_RESPONSE_DEBUG_DUMP,
  PROVIDER_GOOGLE,
  PROVIDER_OLLAMA,
  PROVIDER_OPENAI,
  TOKENS_PER_COST_UNIT,
} from "@exaix/core";
import { HTTP_FORBIDDEN, HTTP_TOO_MANY_REQUESTS, HTTP_UNAUTHORIZED } from "@exaix/core";
import { type Opt, type Reason, type SafeJsonInput, toSafeJson } from "@exaix/core/types";

export type TokenMap = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  model?: string;
  cost_usd?: number;
  provider?: string;
  /** Anthropic prompt-cache read tokens. undefined when the provider doesn't report
   *  cache usage or no cache_control was set on this call — never 0 for "unknown". */
  cache_read_tokens?: number;
  /** Anthropic prompt-cache write (creation) tokens, one-time per cache segment. */
  cache_creation_tokens?: number;
};

type ResponseTokenMapper<T> = (data: T, providerId?: string) => TokenMap | undefined;

// Provider Response Interfaces
export type OllamaResponse = {
  model: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
};

export type OpenAIUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
};

export type OpenAIResponse = {
  usage?: OpenAIUsage;
  choices?: Array<{
    message?: {
      content?: string;
    };
    text?: string;
  }>;
};

export type GoogleUsageMetadata = {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount?: number;
};

export type GoogleResponse = {
  usageMetadata?: GoogleUsageMetadata;
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

export type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  /** Real, documented Anthropic Messages API fields — populated only when prompt caching
   *  was used on this call (anthropic_provider.ts sends cache_control on prompt blocks). */
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type AnthropicResponse = {
  usage?: AnthropicUsage;
  /** Why generation ended: "end_turn", "max_tokens" (truncated), "stop_sequence", ... */
  stop_reason?: string;
  content?: Array<{
    /** Block type, e.g. "text" or "thinking". Absent in older response shapes. */
    type?: string;
    text?: string;
    thinking?: string;
  }>;
};

/**
 * Calculate cost for token usage based on provider
 */
export function calculateCost(provider: string, totalTokens: number): number {
  const rates: Record<string, number> = {
    [PROVIDER_OPENAI]: COST_RATE_OPENAI,
    [PROVIDER_ANTHROPIC]: COST_RATE_ANTHROPIC,
    [PROVIDER_GOOGLE]: COST_RATE_GOOGLE,
    [PROVIDER_OLLAMA]: COST_RATE_OLLAMA,
    [PROVIDER_MOCK]: COST_RATE_MOCK,
  };

  // Extract provider name from id (e.g., "google-gemini-2.0-flash-exp" -> "google")
  const providerKey = provider.split("-")[0].toLowerCase(); // This assumes provider constants are lowercase strings
  const rate = rates[providerKey] ?? 0;
  return rate * (totalTokens / TOKENS_PER_COST_UNIT);
}

/**
 * Map a provider error response to the retry-semantics-bearing error class. The body's
 * documented error type (docs.anthropic.com/en/api/errors) wins over the HTTP status, so a
 * transient overloaded_error/rate_limit_error stays retryable even under a surprising
 * status; status-based mapping remains the fallback for untyped bodies.
 */
function classifyProviderError(
  status: number,
  errorType: Opt<string, Reason.OptionalContext>,
  message: string,
  id: string,
): Error {
  if (errorType === "authentication_error" || errorType === "permission_error") {
    return new AuthenticationError(id, message);
  }
  if (errorType === "rate_limit_error") {
    return new RateLimitError(id, message);
  }
  if (errorType === "overloaded_error" || errorType === "api_error") {
    return new ConnectionError(id, message);
  }
  if (
    errorType === "invalid_request_error" || errorType === "not_found_error" ||
    errorType === "request_too_large"
  ) {
    return new ModelProviderError(message, id);
  }
  if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN) {
    return new AuthenticationError(id, message);
  }
  if (status === HTTP_TOO_MANY_REQUESTS) {
    return new RateLimitError(id, message);
  }
  if (status >= 500) {
    // Treat server (5xx) responses as connection-level failures
    return new ConnectionError(id, message);
  }
  return new ModelProviderError(message, id);
}

export async function handleProviderResponse<T>(
  response: Response,
  id: string,
  logger?: Opt<IEventLogger, Reason.OptionalDependency>,
  tokenMapper?: Opt<ResponseTokenMapper<T>, Reason.OptionalDependency>,
): Promise<T> {
  if (!response.ok) {
    // Include HTTP status code in messages so tests can assert on it (e.g. "HTTP 503").
    let message = `HTTP ${response.status} ${response.statusText}`;
    let errorType: string | undefined;
    try {
      const error = await response.json();
      errorType = error.error?.type ?? undefined;
      const remoteMsg = error.error?.message ?? error.message ?? undefined;
      if (remoteMsg) {
        // Surface the machine-readable error type alongside the human message —
        // it is the contract the API documents (e.g. "invalid_request_error").
        message = errorType
          ? `HTTP ${response.status} ${errorType}: ${remoteMsg}`
          : `HTTP ${response.status} ${remoteMsg}`;
      }
    } catch {
      // ignore JSON parse errors and fallback to statusText
    }
    throw classifyProviderError(response.status, errorType, message, id);
  }

  const data = await response.json() as T;

  if (logger && tokenMapper) {
    try {
      const tokens = tokenMapper(data, id);
      if (tokens) {
        const inputTokens = tokens.prompt_tokens ?? 0;
        const outputTokens = tokens.completion_tokens ?? 0;
        const totalTokens = tokens.total_tokens ?? inputTokens + outputTokens;
        await logger.info(DomainEventType.LlmUsageRecorded, id, {
          ...tokens,
          provider: tokens.provider ?? id,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: totalTokens,
        });
      }
    } catch {
      // never fail the provider call because token logging failed
    }
  }

  return data;
}

/** Token mapper for OpenAI response shape */
export function tokenMapperOpenAI(model: string): ResponseTokenMapper<OpenAIResponse> {
  return (d: OpenAIResponse, providerId?: Opt<string, Reason.OptionalContext>): TokenMap | undefined => {
    if (!d.usage) return undefined;

    const totalTokens = d.usage.total_tokens ?? (d.usage.prompt_tokens + d.usage.completion_tokens);
    const cost = providerId ? calculateCost(providerId, totalTokens) : undefined;

    return {
      prompt_tokens: d.usage.prompt_tokens,
      completion_tokens: d.usage.completion_tokens,
      total_tokens: totalTokens,
      model,
      cost_usd: cost,
    };
  };
}

/** Extract textual content from OpenAI response */
export function extractOpenAIContent(d: OpenAIResponse): string {
  return d.choices?.[0]?.message?.content ?? "";
}

export function createOpenAIChatCompletionsRequestInit(
  apiKey: string,
  model: string,
  prompt: string,
  options?: Opt<IModelOptions, Reason.OptionalInput>,
): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: options?.max_tokens,
      temperature: options?.temperature,
      top_p: options?.top_p,
      stop: options?.stop,
    }),
  };
}

/** Token mapper for Google response shape */
export function tokenMapperGoogle(model: string): ResponseTokenMapper<GoogleResponse> {
  return (d: GoogleResponse, providerId?: Opt<string, Reason.OptionalContext>): TokenMap | undefined => {
    if (!d.usageMetadata) return undefined;

    const totalTokens = d.usageMetadata.totalTokenCount ??
      (d.usageMetadata.promptTokenCount + d.usageMetadata.candidatesTokenCount);
    const cost = providerId ? calculateCost(providerId, totalTokens) : undefined;

    return {
      prompt_tokens: d.usageMetadata.promptTokenCount,
      completion_tokens: d.usageMetadata.candidatesTokenCount,
      total_tokens: totalTokens,
      model,
      cost_usd: cost,
    };
  };
}

/** Extract textual content from Google response */
export function extractGoogleContent(d: GoogleResponse): string {
  return d.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

/** Token mapper for Anthropic response shape */
export function tokenMapperAnthropic(model: string): ResponseTokenMapper<AnthropicResponse> {
  return (d: AnthropicResponse, providerId?: Opt<string, Reason.OptionalContext>): TokenMap | undefined => {
    if (!d.usage) return undefined;

    const totalTokens = (d.usage.input_tokens ?? 0) + (d.usage.output_tokens ?? 0);
    const cost = providerId ? calculateCost(providerId, totalTokens) : undefined;

    return {
      prompt_tokens: d.usage.input_tokens,
      completion_tokens: d.usage.output_tokens,
      total_tokens: totalTokens,
      model,
      cost_usd: cost,
      cache_read_tokens: d.usage.cache_read_input_tokens,
      cache_creation_tokens: d.usage.cache_creation_input_tokens,
    };
  };
}

/**
 * Extract textual content from Anthropic response. Thinking-capable models (Claude 5 family)
 * prepend a `thinking` content block before the `text` block when adaptive thinking triggers,
 * so taking content[0] blindly returns "" exactly when the model thought hardest — join every
 * text-bearing block instead (skipping blocks explicitly typed as something other than text).
 */
export function extractAnthropicContent(d: AnthropicResponse): string {
  if (!d.content) return "";
  return d.content
    .filter((block) => block.type === undefined || block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

/**
 * Perform fetch with retries/backoff and timeout, and handle provider responses.
 * Centralizes abort handling, retry/backoff, and ensures bodies are consumed.
 */
export async function fetchJsonWithRetries<T>(
  url: string,
  fetchOptions: RequestInit,
  {
    id,
    maxAttempts = DEFAULT_AI_RETRY_MAX_ATTEMPTS,
    backoffBaseMs = DEFAULT_AI_RETRY_BACKOFF_BASE_MS,
    timeoutMs,
    logger,
    tokenMapper,
  }: {
    id: string;
    maxAttempts?: number;
    backoffBaseMs?: number;
    timeoutMs?: number;
    logger?: IEventLogger;
    tokenMapper?: (d: T, providerId?: string) => TokenMap | undefined;
  },
): Promise<T> {
  // Use the withRetry helper to centralize retry/backoff semantics
  const attemptFn = async () => {
    const controller = typeof timeoutMs === "number" ? new AbortController() : undefined;
    const signal = controller?.signal;
    const timeoutId = controller && typeof timeoutMs === "number"
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

    try {
      const response = await fetch(url, { ...fetchOptions, signal });
      // Let handleProviderResponse inspect status, parse JSON and throw typed errors
      const data = await handleProviderResponse<T>(response, id, logger, tokenMapper);
      if (timeoutId) clearTimeout(timeoutId);
      return data;
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      // Rethrow to allow withRetry to decide whether to retry
      throw err;
    }
  };

  // Use withRetry defined in providers/common.ts
  return await withRetry(attemptFn, { maxRetries: maxAttempts, baseDelayMs: backoffBaseMs });
}

/**
 * Perform a provider call: fetch JSON with retries, then extract textual content using the provided extractor.
 * This centralizes the common provider pattern: fetch -> handleProviderResponse -> extract content.
 */
export async function performProviderCall<T>(
  url: string,
  fetchOptions: RequestInit,
  {
    id,
    maxAttempts = DEFAULT_AI_RETRY_MAX_ATTEMPTS,
    backoffBaseMs = DEFAULT_AI_RETRY_BACKOFF_BASE_MS,
    timeoutMs,
    logger,
    tokenMapper,
    extractor,
    stopReasonExtractor,
  }: {
    id: string;
    maxAttempts?: number;
    backoffBaseMs?: number;
    timeoutMs?: number;
    logger?: IEventLogger;
    tokenMapper?: (d: T, providerId?: string) => TokenMap | undefined;
    extractor?: (d: T) => string;
    stopReasonExtractor?: (d: T) => string | undefined;
  },
): Promise<IGenerateResult> {
  const data = await fetchJsonWithRetries<T>(url, fetchOptions, {
    id,
    maxAttempts,
    backoffBaseMs,
    timeoutMs,
    logger,
    tokenMapper,
  });
  // Debug-level dump of the complete raw response body, symmetric with
  // provider.request_debug_dump: content extraction deliberately strips parts of the
  // response (e.g. thinking blocks), so follow-up investigation of a live-provider
  // issue needs the unfiltered body in the journal.
  if (logger) {
    void logger.debug(PROVIDER_EVENT_RESPONSE_DEBUG_DUMP, id, {
      provider: id,
      response_body: toSafeJson(data as SafeJsonInput) ?? {},
    });
  }
  const content = extractor
    ? extractor(data)
    : ((data as OpenAIResponse)?.choices?.[0]?.message?.content ?? (data as OpenAIResponse)?.choices?.[0]?.text ?? "");

  const tokens = tokenMapper ? tokenMapper(data, id) : undefined;
  return {
    content: content ?? "",
    usage: {
      promptTokens: tokens?.prompt_tokens ?? 0,
      completionTokens: tokens?.completion_tokens ?? 0,
      totalTokens: tokens?.total_tokens ?? 0,
      cacheReadTokens: tokens?.cache_read_tokens,
      cacheCreationTokens: tokens?.cache_creation_tokens,
    },
    cost_usd: tokens?.cost_usd,
    model: tokens?.model ?? "unknown",
    provider: tokens?.provider ?? id,
    stop_reason: stopReasonExtractor?.(data),
  };
}
