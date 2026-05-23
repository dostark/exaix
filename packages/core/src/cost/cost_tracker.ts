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
import type { ICostFilter, IProviderCostRecord } from "../types/mod.ts";
import {
  COST_RATE_ANTHROPIC,
  COST_RATE_GOOGLE,
  COST_RATE_MOCK,
  COST_RATE_OLLAMA,
  COST_RATE_OPENAI,
  DEFAULT_COST_TRACKING_BATCH_DELAY_MS,
  DEFAULT_COST_TRACKING_MAX_BATCH_SIZE,
  TOKENS_PER_COST_UNIT,
} from "../../mod.ts";
import { ProviderType } from "../../mod.ts";

/**
 * Service for tracking and managing LLM provider costs.
 * Provides budget enforcement and cost analytics.
 */
export class CostTracker implements ICostTracker {
  private static getCostRates(config?: Config): Record<string, number> {
    const configuredRates = config?.cost_tracking?.rates ?? {};
    const defaultRates: Record<string, number> = {
      [ProviderType.OPENAI]: COST_RATE_OPENAI,
      [ProviderType.ANTHROPIC]: COST_RATE_ANTHROPIC,
      [ProviderType.GOOGLE]: COST_RATE_GOOGLE,
      [ProviderType.OLLAMA]: COST_RATE_OLLAMA,
      [ProviderType.MOCK]: COST_RATE_MOCK,
    };

    return { ...defaultRates, ...configuredRates };
  }

  private pendingRecords: Array<Omit<IProviderCostRecord, "id"> & { requests: number }> = [];
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private db: IDatabaseService, private config?: Config) {}

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
    } = {},
  ): Promise<void> {
    const cost = this.estimateCost(provider, tokens);
    const record: Omit<IProviderCostRecord, "id"> & { requests: number } = {
      provider,
      model: options.model ?? "unknown",
      requests: 1,
      tokens,
      promptTokens: options.promptTokens ?? 0,
      completionTokens: options.completionTokens ?? 0,
      estimatedCostUsd: cost,
      traceId: options.traceId,
      portal: options.portal,
      timestamp: new Date(),
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
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
    traceId?: string,
    portal?: string,
  ): Promise<number> {
    const cost = this.estimateCost(provider, usage.totalTokens);
    await this.trackRequest(provider, usage.totalTokens, {
      model,
      traceId,
      portal,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    });
    return cost;
  }

  async persistEntry(record: IProviderCostRecord): Promise<void> {
    await this.trackRequest(record.provider, record.tokens, {
      model: record.model,
      traceId: record.traceId,
      portal: record.portal,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
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
             trace_id as traceId, portal, timestamp
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
    }>(query, params);

    return rows.map((row) => ({
      ...row,
      traceId: row.traceId ?? undefined,
      portal: row.portal ?? undefined,
      timestamp: new Date(row.timestamp),
    }));
  }

  getTotalCost(_provider?: string, _model?: string): number {
    return 0;
  }

  async isWithinBudget(provider?: string, budget?: number): Promise<boolean> {
    const dailyBudget = budget ?? this.config?.provider_strategy?.max_daily_cost_usd ?? 5.0;
    const dailyCost = await this.getDailyCost(provider);
    return dailyCost < dailyBudget;
  }

  async getDailyCost(provider?: string): Promise<number> {
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

    return result?.total_cost ?? 0;
  }

  async getCostSummary(
    startDate: Date,
    endDate: Date,
    provider?: string,
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

    return rows.map((row) => ({
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
  }

  private estimateCost(provider: string, tokens: number): number {
    const rates = CostTracker.getCostRates();
    const rate = rates[provider] ?? 0;
    return rate * (tokens / TOKENS_PER_COST_UNIT);
  }

  private async insertCostRecordsBatch(
    records: Array<Omit<IProviderCostRecord, "id"> & { requests: number }>,
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const placeholders = records.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const query = `
      INSERT INTO provider_costs (id, provider, model, requests, tokens, prompt_tokens, completion_tokens, estimated_cost_usd, trace_id, portal, timestamp)
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
        record.traceId ?? null,
        record.portal ?? null,
        record.timestamp.toISOString(),
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
    await this.flushBatch();
  }
}
