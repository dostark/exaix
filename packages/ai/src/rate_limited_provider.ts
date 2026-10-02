/**
 * @module RateLimitedProvider
 * @path packages/ai/src/rate_limited_provider.ts
 * @description Resiliency wrapper for AI providers that enforces rate limits (calls/tokens/cost) to prevent cost exhaustion attacks.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers.ts, "packages/core/src/cost/cost_tracker.ts"]
 */

import type { IModelOptions, IModelProvider } from "./types.ts";
import type { IGenerateResult } from "./providers/common.ts";
import type { ICostBudgetAllowance, ICostTracker, Opt, Reason } from "@exaix/core/types";
import type { BindingTransport } from "@exaix/schemas";
import { ProviderRegistry } from "./provider_registry.ts";
import { ProviderCallPolicyError } from "./errors.ts";
import {
  BINDING_TRANSPORT_CLOUD,
  BINDING_TRANSPORT_LOCAL,
  COST_BUDGET_REASON_PRICING_UNAVAILABLE,
  OPENAI_COMPATIBLE_UNPRICED_PROFILES,
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
  /** Binding identity (service/transport) of a bound provider, enabling the global and
   *  per-service cloud caps below. Absent keeps the legacy per-provider cap path. */
  bindingIdentity?: { service: string; transport: BindingTransport; dailyCostCapUsd?: number };
  /** Async predicate deciding global admission for calls outside a run (the boot provider).
   *  Absent means per-provider cap, as today. */
  globalBudget?: () => Promise<boolean>;
  /** The finite global daily cap, applied only while `globalBudget` resolves true. */
  globalCapUsd?: number;
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
  private readonly compatibleUnpriced: boolean;
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
    // local-test and self-hosted carry no verified price, so their usage stays unpriced.
    this.compatibleUnpriced = this.compatible &&
      OPENAI_COMPATIBLE_UNPRICED_PROFILES.includes(inner.callCapabilities?.profile ?? "");
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
    const bindingMode = await this.resolveBudgetMode(finiteRemoteBudget);
    const reservation = await this.acquireReservation(bindingMode, estimatedCost, options?.traceId);
    await this.checkAdmission(estimatedTokens, estimatedCost, bindingMode.enabled);

    // Track before call (pessimistic)
    this.callsThisMinute++;
    this.tokensThisHour += estimatedTokens;
    this.costThisDay += estimatedCost;

    let generated = false;
    try {
      const result = await this.inner.generate(prompt, options);
      generated = this.compatible;
      if (this.compatible) this.costThisDay += (result.cost_usd ?? 0) - estimatedCost;
      await this.persistUsage(result, options?.traceId, bindingMode);

      if (this.compatible && !this.compatibleUnpriced && result.costStatus === "unknown") {
        this.hasUnpricedRemoteUsage = true;
        if (finiteRemoteBudget) {
          throw new ProviderCallPolicyError("pricing_unavailable", this.callCapabilities?.profile ?? this.id);
        }
      }
      if (reservation) await this.settleReservation(reservation, result.cost_usd);
      return result;
    } catch (error) {
      // Rollback tracking on error
      if (!generated) {
        this.callsThisMinute--;
        this.tokensThisHour -= estimatedTokens;
        this.costThisDay -= estimatedCost;
      }
      if (reservation) await this.releaseReservation(reservation);
      throw error;
    }
  }

  /** Reserve an upper bound for a cloud call when the budget mode is active and the tracker
   *  supports reservations. Otherwise no reservation applies. */
  private async acquireReservation(
    bindingMode: {
      enabled: boolean;
      service: string;
      transport: string;
      globalCapUsd?: number;
      serviceCapUsd?: number;
    },
    estimatedCost: number,
    traceId?: Opt<string, Reason.TraceAbsent>,
  ): Promise<ICostBudgetAllowance | undefined> {
    if (!bindingMode.enabled || !this.limits.costTracker?.reserveDailyBudget) return undefined;
    const reservation = await this.limits.costTracker.reserveDailyBudget({
      service: bindingMode.service,
      transport: bindingMode.transport as BindingTransport,
      provider: this.extractProviderName(this.inner.id),
      estimatedUsd: bindingMode.transport === BINDING_TRANSPORT_LOCAL ? 0 : estimatedCost,
      globalCapUsd: bindingMode.globalCapUsd,
      serviceCapUsd: bindingMode.serviceCapUsd,
      traceId,
    });
    if (!reservation.allowed) {
      if (reservation.reason === COST_BUDGET_REASON_PRICING_UNAVAILABLE) {
        throw new ProviderCallPolicyError(
          COST_BUDGET_REASON_PRICING_UNAVAILABLE,
          this.callCapabilities?.profile ?? this.id,
        );
      }
      throw new RateLimiterError(
        `Global or service cost budget exceeded for ${this.limits.bindingIdentity?.service ?? this.id}`,
      );
    }
    return reservation;
  }

  /** Decide whether this call runs under the global or service budget mode.
   *  A bound provider always uses the mode. The boot provider uses it only while its async
   *  globalBudget predicate resolves true. Local transport carries its own service cap and
   *  never consumes a cloud global cap. */
  private async resolveBudgetMode(finiteRemoteBudget: boolean): Promise<{
    enabled: boolean;
    service: string;
    transport: string;
    globalCapUsd?: number;
    serviceCapUsd?: number;
  }> {
    const identity = this.limits.bindingIdentity;
    if (identity) {
      return {
        enabled: true,
        service: identity.service,
        transport: identity.transport,
        globalCapUsd: this.limits.globalCapUsd,
        serviceCapUsd: identity.transport === BINDING_TRANSPORT_CLOUD ? identity.dailyCostCapUsd : undefined,
      };
    }
    if (this.limits.globalBudget) {
      const active = await this.limits.globalBudget();
      if (active) {
        return {
          enabled: true,
          service: this.extractProviderName(this.inner.id),
          transport: finiteRemoteBudget ? BINDING_TRANSPORT_CLOUD : BINDING_TRANSPORT_LOCAL,
          globalCapUsd: this.limits.globalCapUsd,
        };
      }
    }
    return { enabled: false, service: "", transport: BINDING_TRANSPORT_LOCAL };
  }

  private async settleReservation(
    reservation: ICostBudgetAllowance,
    actualUsd: Opt<number, Reason.OptionalInput>,
  ): Promise<void> {
    const tracker = this.limits.costTracker;
    if (!tracker?.settleDailyBudget) return;
    const actual = Number.isFinite(actualUsd) && actualUsd! >= 0 ? actualUsd! : 0;
    await tracker.settleDailyBudget(reservation.reservationId!, actual);
  }

  private async releaseReservation(reservation: ICostBudgetAllowance): Promise<void> {
    const tracker = this.limits.costTracker;
    if (!tracker?.releaseDailyBudget) return;
    await tracker.releaseDailyBudget(reservation.reservationId!);
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
    const price = this.compatible && !this.compatibleUnpriced
      ? await this.estimateCallCost?.(estimatedTokens, options?.max_tokens ?? TOKEN_ESTIMATION_MAX_TOKENS)
      : undefined;
    const finiteRemoteBudget = this.compatible && !this.compatibleUnpriced &&
      Number.isFinite(this.limits.maxCostPerDay);
    if (
      finiteRemoteBudget && (price === undefined || !Number.isFinite(price) || price < 0 || this.hasUnpricedRemoteUsage)
    ) {
      throw new ProviderCallPolicyError("pricing_unavailable", this.callCapabilities?.profile ?? this.id);
    }
    const estimatedCost = this.compatible ? price ?? 0 : (estimatedTokens / 1000) * this.limits.costPer1kTokens;
    return { estimatedTokens, estimatedCost, finiteRemoteBudget };
  }

  private async checkAdmission(
    estimatedTokens: number,
    estimatedCost: number,
    bindingModeActive: boolean,
  ): Promise<void> {
    if (this.tokensThisHour + estimatedTokens > this.limits.maxTokensPerHour) {
      throw new RateLimiterError(`Rate limit exceeded: ${this.limits.maxTokensPerHour} tokens per hour`);
    }

    if (this.costThisDay + estimatedCost > this.limits.maxCostPerDay) {
      throw new RateLimiterError(
        `Cost limit exceeded: $${this.costThisDay.toFixed(2)}/$${this.limits.maxCostPerDay} per day`,
      );
    }

    // Binding mode (global/per-service cloud caps) is handled by reserveDailyBudget
    // above. The legacy per-provider path below applies only outside it.
    if (bindingModeActive) return;
    if (this.limits.costTracker && !this.compatibleUnpriced) {
      const providerName = this.extractProviderName(this.inner.id);
      const withinBudget = await this.limits.costTracker.isWithinBudget(providerName, this.limits.maxCostPerDay);
      if (!withinBudget) {
        throw new RateLimiterError(`Persistent cost budget exceeded for ${providerName}`);
      }
    }
  }

  private async persistUsage(
    result: IGenerateResult,
    traceId?: Opt<string, Reason.TraceAbsent>,
    budgetMode: { enabled: boolean; service: string; transport: string } = {
      enabled: false,
      service: "",
      transport: BINDING_TRANSPORT_LOCAL,
    },
  ): Promise<void> {
    const tracker = this.limits.costTracker;
    // A nested rate-limited wrapper defers persistence to its inner wrapper, avoiding a
    // double cost record.
    if (!tracker || this.inner instanceof RateLimitedProvider) return;
    const providerName = this.extractProviderName(this.inner.id);
    const model = result.model || this.inner.id;
    // The boot provider enters the global budget mode through its predicate. Its spend
    // carries the cloud transport so the global cap counts it. A bound provider uses its
    // own service identity. No identity attaches outside the mode.
    const identity: { service: string; transport: BindingTransport } | undefined =
      budgetMode.enabled || this.limits.bindingIdentity
        ? {
          service: this.limits.bindingIdentity?.service ?? budgetMode.service,
          transport: budgetMode.transport as BindingTransport,
        }
        : undefined;
    const usage = {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
    };
    if (result.costStatus === "unknown") {
      await tracker.recordUnpricedGeneration?.(providerName, model, usage, traceId, identity);
      return;
    }
    await tracker.trackGeneration(
      providerName,
      model,
      {
        ...usage,
        costUsd: result.cost_usd,
        costSource: result.cost_usd !== undefined
          ? (this.compatible ? "registry_computed" : "provider_reported")
          : undefined,
        cacheReadTokens: result.usage.cacheReadTokens,
        cacheCreationTokens: result.usage.cacheCreationTokens,
      },
      traceId,
      undefined,
      identity,
    );
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
