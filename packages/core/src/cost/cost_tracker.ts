/**
 * @module CostTracker
 * @path packages/core/src/cost/cost_tracker.ts
 * @description Service for tracking and managing LLM provider costs, token usage, and budget enforcement.
 * @architectural-layer Domain
 * @related-files ["packages/core/src/types/i_cost_tracker.ts", "packages/schemas/src/config.ts"]
 */
import type { SqliteParam } from "../types/mod.ts";
import type { IDatabaseService } from "../types/mod.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { ICostTracker } from "../types/mod.ts";
import type { CostSource, ICostFilter, IModelPricingLookup, IProviderCostRecord } from "../types/mod.ts";
import {
  COST_RATE_ANTHROPIC,
  COST_RATE_GOOGLE,
  COST_RATE_LLAMACPP,
  COST_RATE_MOCK,
  COST_RATE_OLLAMA,
  COST_RATE_OPENAI,
  COST_RATE_OPENROUTER,
  COST_RATE_VERTEX,
  DEFAULT_COST_DIVERGENCE_TOLERANCE_PCT,
  DEFAULT_COST_TRACKING_BATCH_DELAY_MS,
  DEFAULT_COST_TRACKING_MAX_BATCH_SIZE,
  TOKENS_PER_COST_UNIT,
} from "../../mod.ts";
import { ProviderType } from "../../mod.ts";
import type { IEventLogger } from "../logger/mod.ts";
import { DomainEventType, type IModelCostDivergencePayload } from "../events/mod.ts";
import type { LogMetadata, Opt, Reason } from "../types/mod.ts";

/** USD-per-Mtok → USD-per-token divisor (pricing is quoted per 1M tokens). */
const TOKENS_PER_MTOK = 1_000_000;
/** Percent → fraction divisor. */
const PERCENT = 100;

/** A record pending batch insert into provider_costs, before an id is assigned. */
type IPendingCostRecord = Omit<IProviderCostRecord, "id" | "costSource"> & {
  requests: number;
  costSource: CostSource | null;
};

/**
 * Service for tracking and managing LLM provider costs.
 * Provides budget enforcement and cost analytics.
 * @visible
 */
export class CostTracker implements ICostTracker {
  private static getCostRates(
    config?: Opt<Config, Reason.FactoryPreset>,
  ): Record<string, number> {
    const configuredRates = config?.cost_tracking?.rates ?? {};
    const defaultRates: Record<string, number> = {
      [ProviderType.OPENAI]: COST_RATE_OPENAI,
      [ProviderType.ANTHROPIC]: COST_RATE_ANTHROPIC,
      [ProviderType.GOOGLE]: COST_RATE_GOOGLE,
      [ProviderType.VERTEX]: COST_RATE_VERTEX,
      [ProviderType.OPENROUTER]: COST_RATE_OPENROUTER,
      [ProviderType.OLLAMA]: COST_RATE_OLLAMA,
      [ProviderType.LLAMACPP]: COST_RATE_LLAMACPP,
      [ProviderType.MOCK]: COST_RATE_MOCK,
    };

    return { ...defaultRates, ...configuredRates };
  }

  private pendingRecords: IPendingCostRecord[] = [];
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;
  private pricingLookup?: IModelPricingLookup;

  constructor(
    private db: IDatabaseService,
    private config?: Opt<Config, Reason.SensibleDefault>,
    private eventLogger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ) {}

  /**
   * Late-bind the edition-selected pricing lookup (Phase 135 GAP-4). Called by the
   * daemon AFTER the registry is selected — the tracker is constructed earlier, so a
   * constructor param alone cannot carry it. When set, trackGeneration prices
   * split-per-Mtok (cost_source "registry_computed"); when unset, the legacy blended
   * estimate is used (cost_source null).
   */
  setPricingLookup(lookup: IModelPricingLookup): void {
    this.pricingLookup = lookup;
    void this.eventLogger?.info(DomainEventType.CostPricingLookupSet, "pricing_lookup", {
      configured: true,
    });
  }

  private get divergenceTolerancePct(): number {
    return this.config?.model_registry?.cost_divergence_tolerance_pct ??
      DEFAULT_COST_DIVERGENCE_TOLERANCE_PCT;
  }

  private get batchDelayMs(): number {
    return this.config?.cost_tracking?.batch_delay_ms ?? DEFAULT_COST_TRACKING_BATCH_DELAY_MS;
  }

  private get maxBatchSize(): number {
    return this.config?.cost_tracking?.max_batch_size ?? DEFAULT_COST_TRACKING_MAX_BATCH_SIZE;
  }

  /**
   * Track a provider request with token usage.
   * Internal implementation for batching.
   */
  private async trackRequest(
    provider: string,
    tokens: number,
    options: {
      model?: string;
      traceId?: string;
      portal?: string;
      promptTokens?: number;
      completionTokens?: number;
      costUsd?: number;
      costSource?: CostSource;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      /** Pre-resolved cost/source (avoids recomputing + double divergence emission). */
      resolved?: { cost: number; source: CostSource | null };
    } = {},
  ): Promise<void> {
    const priced = options.resolved ?? await this.resolveCost(provider, tokens, options);
    const record: IPendingCostRecord = {
      provider,
      model: options.model ?? "unknown",
      requests: 1,
      tokens,
      promptTokens: options.promptTokens ?? 0,
      completionTokens: options.completionTokens ?? 0,
      estimatedCostUsd: priced.cost,
      costSource: priced.source,
      traceId: options.traceId,
      portal: options.portal,
      timestamp: new Date(),
      cacheReadTokens: options.cacheReadTokens,
      cacheCreationTokens: options.cacheCreationTokens,
    };

    this.pendingRecords.push(record);

    if (this.pendingRecords.length >= this.maxBatchSize) {
      await this.flushBatch();
      return;
    }

    if (this.batchTimeout === null) {
      this.batchTimeout = setTimeout(() => {
        this.flushBatch().catch((error) => {
          console.error("Failed to flush cost tracking batch:", error);
        });
      }, this.batchDelayMs);
    }
  }

  async trackGeneration(
    provider: string,
    model: string,
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      costUsd?: number;
      costSource?: CostSource;
    },
    traceId?: Opt<string, Reason.TraceAbsent>,
    portal?: Opt<string, Reason.OptionalContext>,
  ): Promise<number> {
    const priced = await this.resolveCost(provider, usage.totalTokens, {
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: usage.costUsd,
      costSource: usage.costSource,
      traceId,
    });
    await this.trackRequest(provider, usage.totalTokens, {
      model,
      traceId,
      portal,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      resolved: priced, // reuse the resolved cost — do not recompute (avoids double divergence)
    });
    return priced.cost;
  }

  /**
   * §5.5 reconciliation. Precedence: caller-supplied provider-reported cost →
   * split-priced from the injected lookup (registry_computed) → legacy blended
   * estimate (cost_source null). When both a reported and a computed cost exist and
   * differ beyond the tolerance, emits model.cost.divergence.
   */
  private async resolveCost(
    provider: string,
    tokens: number,
    options: {
      model?: string;
      promptTokens?: number;
      completionTokens?: number;
      costUsd?: number;
      traceId?: Opt<string, Reason.TraceAbsent>;
      costSource?: CostSource;
    },
  ): Promise<{ cost: number; source: CostSource | null }> {
    const reported = typeof options.costUsd === "number" && Number.isFinite(options.costUsd) &&
        options.costUsd >= 0
      ? options.costUsd
      : undefined;

    const computed = await this.computeSplitPrice(
      provider,
      options.model,
      options.promptTokens ?? 0,
      options.completionTokens ?? 0,
    );
    if (reported !== undefined && computed !== undefined) {
      await this.emitDivergence(provider, options.model, reported, computed, options.traceId);
    }
    if (reported !== undefined) {
      return { cost: reported, source: options.costSource ?? "provider_reported" };
    }
    if (computed !== undefined) {
      return { cost: computed, source: "registry_computed" };
    }
    // Legacy blended estimate (library-compat path).
    return { cost: this.estimateCost(provider, tokens, options.model), source: null };
  }

  /** Split input/output per-Mtok price from the injected lookup, or undefined. */
  private async computeSplitPrice(
    provider: string,
    model: Opt<string, Reason.OptionalInput>,
    promptTokens: number,
    completionTokens: number,
  ): Promise<number | undefined> {
    if (!this.pricingLookup || !model) return undefined;
    const pricing = await this.pricingLookup.getModelPricing(provider, model);
    if (pricing.inputPerMtok === undefined && pricing.outputPerMtok === undefined) return undefined;
    const inputCost = ((pricing.inputPerMtok ?? 0) * promptTokens) / TOKENS_PER_MTOK;
    const outputCost = ((pricing.outputPerMtok ?? 0) * completionTokens) / TOKENS_PER_MTOK;
    return inputCost + outputCost;
  }

  private async emitDivergence(
    provider: string,
    model: Opt<string, Reason.OptionalInput>,
    reported: number,
    computed: number,
    traceId?: Opt<string, Reason.TraceAbsent>,
  ): Promise<void> {
    if (!this.eventLogger || computed === 0) return;
    const deltaPct = Math.abs(reported - computed) / computed * PERCENT;
    if (deltaPct <= this.divergenceTolerancePct) return;
    const payload: IModelCostDivergencePayload = {
      provider,
      model: model ?? "unknown",
      reported,
      computed,
      delta_pct: deltaPct,
    };
    // IModelCostDivergencePayload is all string/number → a valid LogMetadata (JSONObject).
    const metadata: LogMetadata = { ...payload };
    await this.eventLogger.info(
      DomainEventType.ModelCostDivergence,
      `${provider}:${model ?? "unknown"}`,
      metadata,
      traceId,
    );
  }
  async persistEntry(record: IProviderCostRecord): Promise<void> {
    await this.trackRequest(record.provider, record.tokens, {
      model: record.model,
      traceId: record.traceId,
      portal: record.portal,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
      costUsd: record.estimatedCostUsd,
      costSource: "provider_reported",
      cacheReadTokens: record.cacheReadTokens,
      cacheCreationTokens: record.cacheCreationTokens,
    });
  }

  async queryByCriteria(filter: ICostFilter): Promise<IProviderCostRecord[]> {
    const whereParts: string[] = [];
    const params: SqliteParam[] = [];

    if (filter.traceId) {
      whereParts.push("trace_id = ?");
      params.push(filter.traceId);
    }
    if (filter.portal) {
      whereParts.push("portal = ?");
      params.push(filter.portal);
    }
    if (filter.model) {
      whereParts.push("model = ?");
      params.push(filter.model);
    }
    if (filter.since) {
      whereParts.push("timestamp >= ?");
      params.push(filter.since.toISOString());
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    const query = `
      SELECT id, provider, model, requests, tokens, prompt_tokens as promptTokens,
             completion_tokens as completionTokens, estimated_cost_usd as estimatedCostUsd,
             trace_id as traceId, portal, timestamp, cost_source as costSource,
             cache_read_tokens as cacheReadTokens, cache_creation_tokens as cacheCreationTokens
      FROM provider_costs
      ${whereClause}
      ORDER BY timestamp DESC
    `;

    const rows = await this.db.preparedAll<{
      id: string;
      provider: string;
      model: string;
      requests: number;
      tokens: number;
      promptTokens: number;
      completionTokens: number;
      estimatedCostUsd: number;
      traceId: string | null;
      portal: string | null;
      timestamp: string;
      costSource: CostSource | null;
      cacheReadTokens: number | null;
      cacheCreationTokens: number | null;
    }>(query, params);

    const results = rows.map((row) => ({
      ...row,
      traceId: row.traceId ?? undefined,
      portal: row.portal ?? undefined,
      timestamp: new Date(row.timestamp),
      costSource: row.costSource ?? undefined,
      cacheReadTokens: row.cacheReadTokens ?? undefined,
      cacheCreationTokens: row.cacheCreationTokens ?? undefined,
    }));

    await this.eventLogger?.info(DomainEventType.CostQueriedByCriteria, filter.traceId ?? filter.model ?? "all", {
      resultCount: results.length,
      traceId: filter.traceId ?? null,
      portal: filter.portal ?? null,
      model: filter.model ?? null,
    });

    return results;
  }

  getTotalCost(
    _provider?: Opt<string, Reason.QueryFilter>,
    _model?: Opt<string, Reason.QueryFilter>,
  ): number {
    return 0;
  }

  async isWithinBudget(
    provider?: Opt<string, Reason.QueryFilter>,
    budget?: Opt<number, Reason.SensibleDefault>,
  ): Promise<boolean> {
    const dailyBudget = budget ?? this.config?.provider_strategy?.max_daily_cost_usd ?? 5.0;
    const dailyCost = await this.getDailyCost(provider);
    return dailyCost < dailyBudget;
  }

  async getDailyCost(provider?: Opt<string, Reason.QueryFilter>): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const query = `
      SELECT SUM(estimated_cost_usd) as total_cost
      FROM provider_costs
      WHERE timestamp >= ? AND timestamp < ?
      ${provider ? "AND provider = ?" : ""}
    `;

    const params = provider
      ? [today.toISOString(), tomorrow.toISOString(), provider]
      : [today.toISOString(), tomorrow.toISOString()];

    const result = await this.db.preparedGet<{ total_cost: number | null }>(query, params);
    const totalCost = result?.total_cost ?? 0;

    await this.eventLogger?.info(DomainEventType.CostDailyCostQueried, provider ?? "all", {
      provider: provider ?? null,
      totalCost,
    });

    return totalCost;
  }

  async getCostSummary(
    startDate: Date,
    endDate: Date,
    provider?: Opt<string, Reason.QueryFilter>,
  ): Promise<IProviderCostRecord[]> {
    const query = `
      SELECT id, provider, requests, tokens, estimated_cost_usd as estimatedCostUsd, timestamp
      FROM provider_costs
      WHERE timestamp >= ? AND timestamp < ?
      ${provider ? "AND provider = ?" : ""}
      ORDER BY timestamp DESC
    `;
    const params = provider
      ? [startDate.toISOString(), endDate.toISOString(), provider]
      : [startDate.toISOString(), endDate.toISOString()];

    const rows = await this.db.preparedAll<{
      id: string;
      provider: string;
      requests: number;
      tokens: number;
      estimatedCostUsd: number;
      timestamp: string;
    }>(query, params);

    const results = rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      model: "unknown",
      requests: row.requests,
      tokens: row.tokens,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: row.estimatedCostUsd,
      traceId: undefined,
      portal: undefined,
      timestamp: new Date(row.timestamp),
    }));

    await this.eventLogger?.info(DomainEventType.CostSummaryQueried, provider ?? "all", {
      provider: provider ?? null,
      resultCount: results.length,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });

    return results;
  }

  private estimateCost(provider: string, tokens: number, model?: Opt<string, Reason.OptionalInput>): number {
    const rates = CostTracker.getCostRates(this.config);
    const modelKey = model ? `${provider}:${model}` : provider;
    const rate = rates[modelKey] ?? rates[provider] ?? 0;
    return rate * (tokens / TOKENS_PER_COST_UNIT);
  }

  private async insertCostRecordsBatch(
    records: IPendingCostRecord[],
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const placeholders = records.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const query = `
      INSERT INTO provider_costs (id, provider, model, requests, tokens, prompt_tokens, completion_tokens, estimated_cost_usd, cost_source, trace_id, portal, timestamp, cache_read_tokens, cache_creation_tokens)
      VALUES ${placeholders}
    `;

    const params: SqliteParam[] = [];
    for (const record of records) {
      params.push(
        crypto.randomUUID(),
        record.provider,
        record.model,
        record.requests,
        record.tokens,
        record.promptTokens,
        record.completionTokens,
        record.estimatedCostUsd,
        record.costSource,
        record.traceId ?? null,
        record.portal ?? null,
        record.timestamp.toISOString(),
        record.cacheReadTokens ?? null,
        record.cacheCreationTokens ?? null,
      );
    }

    await this.db.preparedRun(query, params);
  }

  private async flushBatch(): Promise<void> {
    if (this.pendingRecords.length === 0) {
      return;
    }

    const records = [...this.pendingRecords];
    this.pendingRecords = [];
    this.batchTimeout = null;

    await this.insertCostRecordsBatch(records);
  }

  async flush(): Promise<void> {
    if (this.batchTimeout !== null) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    const pendingCount = this.pendingRecords.length;
    await this.flushBatch();
    await this.eventLogger?.info(DomainEventType.CostBatchFlushed, "cost_batch", {
      pendingCount,
    });
  }
}
