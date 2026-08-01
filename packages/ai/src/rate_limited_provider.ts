/**
 * @module RateLimitedProvider
 * @path packages/ai/src/rate_limited_provider.ts
 * @description Resiliency wrapper for AI providers that enforces rate limits (calls/tokens/cost) to prevent cost exhaustion attacks.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers.ts, "packages/core/src/cost/cost_tracker.ts"]
 */

import type { IModelProvider } from "./types.ts";
import type { IGenerateResult } from "./providers/common.ts";
import type { ICostTracker, Opt, Reason } from "@exaix/core/types";
import {
  RATE_LIMIT_WINDOW_DAY_MS,
  RATE_LIMIT_WINDOW_HOUR_MS,
  RATE_LIMIT_WINDOW_MINUTE_MS,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
  TOKEN_ESTIMATION_MAX_TOKENS,
} from "@exaix/core";

/**
 * Configuration for rate limiting
 */
export interface IRateLimitConfig {
  /** Maximum API calls per minute */
  maxCallsPerMinute: number;
  /** Maximum tokens per hour */
  maxTokensPerHour: number;
  /** Maximum cost per day in USD */
  maxCostPerDay: number;
  /** Cost per 1,000 tokens in USD */
  costPer1kTokens: number;
  /** Optional cost tracker for persistent cost tracking */
  costTracker?: ICostTracker;
}

/**
 * Error thrown when rate limits are exceeded
 */
export class RateLimiterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimiterError";
  }
}

/**
 * Provider that enforces rate limits to prevent cost exhaustion attacks
 */
export class RateLimitedProvider implements IModelProvider {
  public readonly id: string;

  public callsThisMinute = 0;
  public tokensThisHour = 0;
  public costThisDay = 0;
  public windowStart = Date.now();
  public hourStart = Date.now();
  public dayStart = Date.now();

  constructor(
    /** Public (Phase 157) so unwrapModelProvider can reach through a decorator chain to
     *  report on the underlying provider (e.g. MockLLMProvider fixture drift). */
    public readonly inner: IModelProvider,
    private limits: IRateLimitConfig,
  ) {
    this.id = `rate-limited-${inner.id}`;
  }

  async generate(
    prompt: string,
    options?: Opt<{ max_tokens?: number }, Reason.OptionalInput>,
  ): Promise<IGenerateResult> {
    this.resetWindowsIfNeeded();

    // Check rate limits
    if (this.callsThisMinute >= this.limits.maxCallsPerMinute) {
      throw new RateLimiterError(`Rate limit exceeded: ${this.limits.maxCallsPerMinute} calls per minute`);
    }

    // Estimate cost and tokens
    const estimatedTokens = this.estimateTokens(prompt, options);
    const estimatedCost = (estimatedTokens / 1000) * this.limits.costPer1kTokens;

    if (this.tokensThisHour + estimatedTokens > this.limits.maxTokensPerHour) {
      throw new RateLimiterError(`Rate limit exceeded: ${this.limits.maxTokensPerHour} tokens per hour`);
    }

    if (this.costThisDay + estimatedCost > this.limits.maxCostPerDay) {
      throw new RateLimiterError(
        `Cost limit exceeded: $${this.costThisDay.toFixed(2)}/$${this.limits.maxCostPerDay} per day`,
      );
    }

    // Check persistent budget if cost tracker is available
    if (this.limits.costTracker) {
      const providerName = this.extractProviderName(this.inner.id);
      const withinBudget = await this.limits.costTracker.isWithinBudget(providerName, this.limits.maxCostPerDay);
      if (!withinBudget) {
        throw new RateLimiterError(`Persistent cost budget exceeded for ${providerName}`);
      }
    }

    // Track before call (pessimistic)
    this.callsThisMinute++;
    this.tokensThisHour += estimatedTokens;
    this.costThisDay += estimatedCost;

    try {
      const result = await this.inner.generate(prompt, options);

      // Track in persistent storage if cost tracker is available
      if (this.limits.costTracker) {
        const providerName = this.extractProviderName(this.inner.id);
        await this.limits.costTracker.trackGeneration(
          providerName,
          result.model || this.inner.id,
          {
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
            // Phase 135: pass provider-reported cost through (e.g. OpenRouter usage.cost).
            costUsd: result.cost_usd,
            costSource: result.cost_usd !== undefined ? "provider_reported" : undefined,
          },
        );
      }

      return result;
    } catch (error) {
      // Rollback tracking on error
      this.callsThisMinute--;
      this.tokensThisHour -= estimatedTokens;
      this.costThisDay -= estimatedCost;
      throw error;
    }
  }

  /**
   * Reset rate limit windows when they expire
   */
  public resetWindowsIfNeeded(): void {
    const now = Date.now();

    // Reset per-minute counter
    if (now - this.windowStart > RATE_LIMIT_WINDOW_MINUTE_MS) {
      this.callsThisMinute = 0;
      this.windowStart = now;
    }

    // Reset hourly counter
    if (now - this.hourStart > RATE_LIMIT_WINDOW_HOUR_MS) {
      this.tokensThisHour = 0;
      this.hourStart = now;
    }

    // Reset daily counter
    if (now - this.dayStart > RATE_LIMIT_WINDOW_DAY_MS) {
      this.costThisDay = 0;
      this.dayStart = now;
    }
  }

  /**
   * Estimate token count for a prompt
   * Rough estimation: 1 token ≈ 4 characters (English text)
   * But cap the estimation to be more conservative for very large prompts
   */
  private estimateTokens(
    prompt: string,
    _options?: Opt<{ max_tokens?: number }, Reason.OptionalInput>,
  ): number {
    // For rate limiting, only count input tokens (prompt), not output tokens
    // This prevents over-estimation that would block legitimate requests
    return Math.min(Math.ceil(prompt.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN), TOKEN_ESTIMATION_MAX_TOKENS);
  }
  /**
   * Extract provider name from provider ID for cost tracking
   * Examples: "anthropic-claude-3-sonnet" -> "anthropic", "openai-gpt-4" -> "openai"
   */
  private extractProviderName(providerId: string): string {
    // Provider IDs follow pattern: "provider-model" or "rate-limited-provider-model"
    const parts = providerId.replace(/^rate-limited-/, "").split("-");
    return parts[0];
  }
}
