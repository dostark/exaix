/**
 * @module AiCommon
 * @path packages/ai/src/providers/common.ts
 * @description Common error classes, retry logic, and result interfaces shared across LLM providers.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/base_provider.ts, packages/ai/src/provider_common_utils.ts]
 */

import type { JSONValue } from "@exaix/core";

/**
 * Result of a model provider generate call.
 */
export interface IGenerateResult {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Anthropic prompt-cache read tokens. undefined when the provider doesn't report
     *  cache usage or no cache_control was set on this call — never 0 for "unknown". */
    cacheReadTokens?: number;
    /** Anthropic prompt-cache write (creation) tokens, one-time per cache segment. */
    cacheCreationTokens?: number;
  };
  model: string;
  provider: string;
  cost_usd?: number;
  streamed?: boolean;
  /**
   * Why the generation ended, when the provider reports it (Anthropic stop_reason:
   * "end_turn", "max_tokens", "stop_sequence", ...). "max_tokens" means the content
   * was truncated mid-generation — callers parsing structured output should treat
   * that as an incomplete response, not a malformed one.
   */
  stop_reason?: string;
  /** Native tool calls the model made. Present only when the provider's response
   *  included a tool_use block(s) AND the caller requested tools via
   *  IModelOptions.tools. May contain multiple entries for parallel tool use.
   *  Absent (undefined) for every response today. */
  toolCalls?: IProviderToolCall[];
}

/** A tool call the model made, surfaced from a provider's native tool_use
 *  response block. Provider-agnostic — Anthropic, OpenAI, and Google all
 *  produce equivalent shapes. */
export interface IProviderToolCall {
  id: string;
  name: string;
  input: Record<string, JSONValue>;
  /** The tool call's type — always "tool_use" for Anthropic, but included
   *  for forward compatibility with future provider support. */
  type?: string;
}
/**
 * Base error class for model provider errors.
 */
export class ModelProviderError extends Error {
  constructor(message: string, public readonly provider: string) {
    super(message);
    this.name = "ModelProviderError";
    Object.setPrototypeOf(this, ModelProviderError.prototype);
  }
}

/**
 * Error thrown when connection to the model provider fails.
 */
export class ConnectionError extends ModelProviderError {
  constructor(provider: string, message: string) {
    super(`Connection failed for provider '${provider}': ${message}`, provider);
    this.name = "ConnectionError";
    Object.setPrototypeOf(this, ConnectionError.prototype);
  }
}

/**
 * Error thrown when a request times out.
 */
export class TimeoutError extends ModelProviderError {
  constructor(provider: string, timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms for provider '${provider}'`, provider);
    this.name = "TimeoutError";
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * Authentication error for model providers.
 */
export class AuthenticationError extends ModelProviderError {
  constructor(provider: string, message: string) {
    super(message, provider);
    this.name = "AuthenticationError";
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

/**
 * Rate limit error for model providers.
 */
export class RateLimitError extends ModelProviderError {
  constructor(provider: string, message: string) {
    super(message, provider);
    this.name = "RateLimitError";
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

/**
 * Quota exceeded error for model providers.
 */
export class QuotaExceededError extends ModelProviderError {
  constructor(provider: string, message: string) {
    super(message, provider);
    this.name = "QuotaExceededError";
    Object.setPrototypeOf(this, QuotaExceededError.prototype);
  }
}

/**
 * Model not found error for model providers.
 */
export class ModelNotFoundError extends ModelProviderError {
  constructor(provider: string, message: string) {
    super(message, provider);
    this.name = "ModelNotFoundError";
    Object.setPrototypeOf(this, ModelNotFoundError.prototype);
  }
}

/**
 * Context length error for model providers.
 */
export class ContextLengthError extends ModelProviderError {
  constructor(provider: string, message: string) {
    super(message, provider);
    this.name = "ContextLengthError";
    Object.setPrototypeOf(this, ContextLengthError.prototype);
  }
}

/**
 * Determines if an error is retryable for model provider operations.
 */
export function isRetryable(error: Error): boolean {
  if (error instanceof RateLimitError) return true;
  if (error instanceof ConnectionError) return true;
  if (error instanceof TimeoutError) return true;
  if (error instanceof ModelProviderError) return false; // Other provider errors are usually not retryable
  return true; // Generic errors (like network) are retryable
}

/**
 * Retry a promise-returning function with exponential backoff.
 * @param fn The async function to retry
 * @param options.maxRetries Maximum number of retries
 * @param options.baseDelayMs Initial delay in ms
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries: number; baseDelayMs: number },
): Promise<T> {
  let lastError: Error | null = null;
  for (let i = 0; i < options.maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (!isRetryable(err)) throw error;
      lastError = err;
      if (i < options.maxRetries - 1) {
        const delay = options.baseDelayMs * Math.pow(2, i);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError ?? new Error("Unknown error in withRetry");
}
