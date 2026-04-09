/**
 * @module CostTracker
 * @path src/services/cost/cost_tracker.ts
 * @description Service for tracking and managing LLM provider costs, token usage, and budget enforcement.
 * @architectural-layer Services
 * * @related-files [src/services/db.ts, src/config/schema.ts]
 */
import type { DatabaseService, SqliteParam } from "../core/db.ts";
import type { Config } from "../../shared/schemas/config.ts";
import {
  COST_RATE_ANTHROPIC,
  COST_RATE_GOOGLE,
  COST_RATE_MOCK,
  COST_RATE_OLLAMA,
  COST_RATE_OPENAI,
  DEFAULT_COST_TRACKING_BATCH_DELAY_MS,
  DEFAULT_COST_TRACKING_MAX_BATCH_SIZE,
  TOKENS_PER_COST_UNIT,
} from "../../shared/constants.ts";
import { ProviderType } from "../../shared/enums.ts";

/**
 * Cost tracking for LLM provider usage.
 * Tracks requests, tokens, and estimated costs per provider.
 */
export interface IProviderCostRecord {
  id: string;
  provider: string;
  requests: number;
  tokens: number;
  estimatedCostUsd: number;
  timestamp: Date;
}

/**
 * Service for tracking and managing LLM provider costs.
 * Provides budget enforcement and cost analytics.
 */
export class CostTracker {
  private static getCostRates(config?: Config): Record<string, number> {
    // Use configured rates if available, otherwise fall back to defaults
    const configuredRates = config?.cost_tracking?.rates ?? {};
    const defaultRates: Record<string, number> = {
      [ProviderType.OPENAI]: COST_RATE_OPENAI,
      [ProviderType.ANTHROPIC]: COST_RATE_ANTHROPIC,
      [ProviderType.GOOGLE]: COST_RATE_GOOGLE,
      [ProviderType.OLLAMA]: COST_RATE_OLLAMA,
      [ProviderType.MOCK]: COST_RATE_MOCK,
    };

    // For now, just return the default rates since registry initialization is complex
    // TODO: Initialize registry properly for dynamic provider discovery
    return { ...defaultRates, ...configuredRates };
  }

  private pendingRecords: Omit<IProviderCostRecord, "id">[] = [];
  private batchTimeout: number | null = null;

  constructor(private db: DatabaseService, private config?: Config) {}

  private get batchDelayMs(): number {
    return this.config?.cost_tracking?.batch_delay_ms ?? DEFAULT_COST_TRACKING_BATCH_DELAY_MS;
  }

  private get maxBatchSize(): number {
    return this.config?.cost_tracking?.max_batch_size ?? DEFAULT_COST_TRACKING_MAX_BATCH_SIZE;
  }

  /**
   * Track a provider request with token usage.
   * Uses batching for improved performance.
   * @param provider - Provider name (e.g., "openai", "anthropic")
   * @param tokens - Number of tokens used in the request
   */
  async trackRequest(provider: string, tokens: number): Promise<void> {
    const cost = this.estimateCost(provider, tokens);
    const record: Omit<IProviderCostRecord, "id"> = {
      provider,
      requests: 1,
      tokens,
      estimatedCostUsd: cost,
      timestamp: new Date(),
    };

    // Add to pending batch
    this.pendingRecords.push(record);

    // Flush immediately if batch is full
    if (this.pendingRecords.length >= this.maxBatchSize) {
      await this.flushBatch();
      return;
    }

    // Schedule batch flush if not already scheduled
    if (this.batchTimeout === null) {
      this.batchTimeout = setTimeout(() => {
        this.flushBatch().catch((error) => {
          console.error("Failed to flush cost tracking batch:", error);
        });
      }, this.batchDelayMs);
    }
  }

  /**
   * Get total daily cost for a specific provider or all providers.
   * @param provider - Optional provider name to filter by
   * @returns Total estimated cost in USD for today
   */
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

  /**
   * Check if the provider is within the daily budget.
   * @param provider - Provider name
   * @param budget - Maximum daily budget in USD
   * @returns True if within budget, false if exceeded
   */
  async isWithinBudget(provider: string, budget: number): Promise<boolean> {
    const dailyCost = await this.getDailyCost(provider);
    return dailyCost < budget;
  }

  /**
   * Get cost summary for a date range.
   * @param startDate - Start date (inclusive)
   * @param endDate - End date (exclusive)
   * @param provider - Optional provider filter
   * @returns Array of cost records
   */
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
      requests: row.requests,
      tokens: row.tokens,
      estimatedCostUsd: row.estimatedCostUsd,
      timestamp: new Date(row.timestamp),
    }));
  }

  /**
   * Estimate cost for a provider and token count.
   * @param provider - Provider name
   * @param tokens - Number of tokens
   * @returns Estimated cost in USD
   */
  private estimateCost(provider: string, tokens: number): number {
    const rates = CostTracker.getCostRates();
    const rate = rates[provider] ?? 0;
    return rate * (tokens / TOKENS_PER_COST_UNIT); // Cost per 1K tokens
  }

  /**
   * Insert multiple cost records into the database in batch.
   */
  private async insertCostRecordsBatch(records: Omit<IProviderCostRecord, "id">[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    // Use batch insert for better performance
    const placeholders = records.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
    const query = `
      INSERT INTO provider_costs (id, provider, requests, tokens, estimated_cost_usd, timestamp)
      VALUES ${placeholders}
    `;

    const params: SqliteParam[] = [];
    for (const record of records) {
      params.push(
        crypto.randomUUID(),
        record.provider,
        record.requests,
        record.tokens,
        record.estimatedCostUsd,
        record.timestamp.toISOString(),
      );
    }

    await this.db.preparedRun(query, params);
  }

  /**
   * Flush pending cost records to database in batch.
   */
  private async flushBatch(): Promise<void> {
    if (this.pendingRecords.length === 0) {
      return;
    }

    const records = [...this.pendingRecords];
    this.pendingRecords = [];
    this.batchTimeout = null;

    await this.insertCostRecordsBatch(records);
  }

  /**
   * Force flush any pending records (useful for shutdown).
   */
  async flush(): Promise<void> {
    if (this.batchTimeout !== null) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    await this.flushBatch();
  }
}
