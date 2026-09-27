/**
 * @module RateLimitedProvider
 * @path packages/ai/src/rate_limited_provider.ts
 * @description Resiliency wrapper for AI providers that enforces rate limits (calls/tokens/cost) to prevent cost exhaustion attacks.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers.ts, "packages/core/src/cost/cost_tracker.ts"]
 */

import type { IModelOptions, IModelProvider } from "./types.ts";
import type { IGenerateResult } from "./providers/common.ts";
import type { ICostTracker, Opt, Reason } from "@exaix/core/types";
import { ProviderRegistry } from "./provider_registry.ts";
import { ProviderCallPolicyError } from "./errors.ts";
import {
  OPENAI_COMPATIBLE_LOCAL_PROFILE,
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
  private readonly compatible: boolean;
  private readonly compatibleLocal: boolean;
  private hasUnpricedRemoteUsage = false;
  public readonly measureInputTokens: IModelProvider["measureInputTokens"];
  public readonly callCapabilities: IModelProvider["callCapabilities"];
  public readonly estimateCallCost: IModelProvider["estimateCallCost"];

  constructor(
    /** Public so unwrapModelProvider can reach through a decorator chain to report on
     *  the underlying provider (e.g. MockLLMProvider fixture drift). */
    public readonly inner: IModelProvider,
    private limits: IRateLimitConfig,
  ) {
    this.compatible = ProviderRegistry.getMetadataForInstance(inner.id)?.supportsNativeConversation === true;
    this.compatibleLocal = this.compatible && inner.callCapabilities?.profile === OPENAI_COMPATIBLE_LOCAL_PROFILE;
    this.id = this.compatible ? inner.id : `rate-limited-${inner.id}`;
    this.measureInputTokens = inner.measureInputTokens?.bind(inner);
    this.callCapabilities = inner.callCapabilities;
    this.estimateCallCost = inner.estimateCallCost?.bind(inner);
  }

  async generate(
    prompt: string,
    options?: Opt<IModelOptions, Reason.OptionalInput>,
  ): Promise<IGenerateResult> {
    this.resetWindowsIfNeeded();

    // Check rate limits
    if (this.callsThisMinute >= this.limits.maxCallsPerMinute) {
      throw new RateLimiterError(`Rate limit exceeded: ${this.limits.maxCallsPerMinute} calls per minute`);
    }

    const { estimatedTokens, estimatedCost, finiteRemoteBudget } = await this.estimateAdmission(prompt, options);
    await this.checkAdmission(estimatedTokens, estimatedCost);

    // Track before call (pessimistic)
    this.callsThisMinute++;
    this.tokensThisHour += estimatedTokens;
    this.costThisDay += estimatedCost;

    let generated = false;
    try {
      const result = await this.inner.generate(prompt, options);
      generated = this.compatible;
      if (this.compatible) this.costThisDay += (result.cost_usd ?? 0) - estimatedCost;
      await this.persistUsage(result, options?.traceId);

      if (this.compatible && !this.compatibleLocal && result.costStatus === "unknown") {
        this.hasUnpricedRemoteUsage = true;
        if (finiteRemoteBudget) {
          throw new ProviderCallPolicyError("pricing_unavailable", this.callCapabilities?.profile ?? this.id);
        }
      }
      return result;
    } catch (error) {
      // Rollback tracking on error
      if (!generated) {
        this.callsThisMinute--;
        this.tokensThisHour -= estimatedTokens;
        this.costThisDay -= estimatedCost;
      }
      throw error;
    }
  }

  private async estimateAdmission(
    prompt: string,
    options?: Opt<IModelOptions, Reason.OptionalInput>,
  ): Promise<{ estimatedTokens: number; estimatedCost: number; finiteRemoteBudget: boolean }> {
    if (this.compatible && !this.measureInputTokens) {
      throw new RateLimiterError("Native conversation provider requires input measurement");
    }
    const estimatedTokens = this.compatible
      ? (await this.measureInputTokens!(prompt, options)).totalTokens
      : this.estimateTokens(prompt, options);
    const price = this.compatible && !this.compatibleLocal
      ? await this.estimateCallCost?.(estimatedTokens, options?.max_tokens ?? TOKEN_ESTIMATION_MAX_TOKENS)
      : undefined;
    const finiteRemoteBudget = this.compatible && !this.compatibleLocal && Number.isFinite(this.limits.maxCostPerDay);
    if (
      finiteRemoteBudget && (price === undefined || !Number.isFinite(price) || price < 0 || this.hasUnpricedRemoteUsage)
    ) {
      throw new ProviderCallPolicyError("pricing_unavailable", this.callCapabilities?.profile ?? this.id);
    }
    const estimatedCost = this.compatible ? price ?? 0 : (estimatedTokens / 1000) * this.limits.costPer1kTokens;
    return { estimatedTokens, estimatedCost, finiteRemoteBudget };
  }

  private async checkAdmission(estimatedTokens: number, estimatedCost: number): Promise<void> {
    if (this.tokensThisHour + estimatedTokens > this.limits.maxTokensPerHour) {
      throw new RateLimiterError(`Rate limit exceeded: ${this.limits.maxTokensPerHour} tokens per hour`);
    }

    if (this.costThisDay + estimatedCost > this.limits.maxCostPerDay) {
      throw new RateLimiterError(
        `Cost limit exceeded: $${this.costThisDay.toFixed(2)}/$${this.limits.maxCostPerDay} per day`,
      );
    }

    // Check persistent budget if cost tracker is available
    if (this.limits.costTracker && !this.compatibleLocal) {
      const providerName = this.extractProviderName(this.inner.id);
      const withinBudget = await this.limits.costTracker.isWithinBudget(providerName, this.limits.maxCostPerDay);
      if (!withinBudget) {
        throw new RateLimiterError(`Persistent cost budget exceeded for ${providerName}`);
      }
    }
  }

  private async persistUsage(result: IGenerateResult, traceId?: Opt<string, Reason.TraceAbsent>): Promise<void> {
    const tracker = this.limits.costTracker;
    if (!tracker) return;
    const providerName = this.extractProviderName(this.inner.id);
    const model = result.model || this.inner.id;
    const usage = {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
    };
    if (result.costStatus === "unknown") {
      await tracker.recordUnpricedGeneration?.(providerName, model, usage, traceId);
      return;
    }
    await tracker.trackGeneration(providerName, model, {
      ...usage,
      costUsd: result.cost_usd,
      costSource: result.cost_usd !== undefined
        ? (this.compatible ? "registry_computed" : "provider_reported")
        : undefined,
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheCreationTokens: result.usage.cacheCreationTokens,
    }, traceId);
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
      this.hasUnpricedRemoteUsage = false;
      this.dayStart = now;
    }
  }

  /** Estimates token count as prompt.length / 4, capped for very large prompts. */
  private estimateTokens(
    prompt: string,
    _options?: Opt<{ max_tokens?: number }, Reason.OptionalInput>,
  ): number {
    // For rate limiting, only count input tokens (prompt), not output tokens
    // This prevents over-estimation that would block legitimate requests
    return Math.min(Math.ceil(prompt.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN), TOKEN_ESTIMATION_MAX_TOKENS);
  }
  /** Extracts provider name from an id like "anthropic-claude-3-sonnet" -> "anthropic". */
  private extractProviderName(providerId: string): string {
    const providerType = ProviderRegistry.getMetadataForInstance(providerId)?.name;
    if (providerType) return providerType;
    // Provider IDs follow pattern: "provider-model" or "rate-limited-provider-model"
    const parts = providerId.replace(/^rate-limited-/, "").split("-");
    return parts[0];
  }
}
