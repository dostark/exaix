/**
 * @module ProviderSelector
 * @path src/ai/provider_selector.ts
 * @description Intelligent provider selection strategy that chooses the optimal LLM provider based on cost, complexity, budget, and health.
 * @architectural-layer AI
 * @related-files [src/ai/provider_registry.ts]
 */

import type { IProviderMetadata, ProviderRegistry } from "./provider_registry.ts";
import type { IProviderFactory } from "./factories/abstract_provider_factory.ts";
import type { CostTracker } from "../services/cost/cost_tracker.ts";
import type { HealthCheckService } from "../services/core/health_check_service.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { getValidatedEnvOverrides, isCIMode, isTestMode } from "@exaix/core/config/env_schema.ts";
import { PricingTier, ProviderCostTier, TaskComplexity } from "@exaix/core";

/**
 * Criteria for selecting a provider
 */
export interface ISelectionCriteria {
  /** Prefer free providers when available */
  preferFree?: boolean;
  /** Maximum daily cost in USD */
  maxCostUsd?: number;
  /** Task complexity level */
  taskComplexity?: TaskComplexity;
  /** Required provider capabilities */
  requiredCapabilities?: string[];
  /** Allow local providers */
  allowLocal?: boolean;
}

/** A registered provider entry with its factory and metadata. */
type ProviderEntry = { factory: IProviderFactory; metadata: IProviderMetadata };

/**
 * Intelligent provider selector that chooses the optimal LLM provider
 * based on cost, capabilities, health, and task requirements.
 */
export class ProviderSelector {
  private selectionMetrics = new Map<string, { count: number; totalTime: number; avgTime: number }>();

  constructor(
    private registry: typeof ProviderRegistry,
    private costTracker: CostTracker,
    private healthChecker: HealthCheckService,
  ) {}

  /**
   * Select the optimal provider based on the given criteria.
   * @param criteria Selection criteria
   * @returns The name of the selected provider
   * @throws Error if no suitable provider is found
   */
  async selectProvider(criteria: ISelectionCriteria): Promise<string> {
    const startTime = performance.now();

    try {
      let candidates = this.registry.getAllProviders();

      // Early filtering by capabilities (fastest check)
      if (criteria.requiredCapabilities) {
        candidates = candidates.filter((p) =>
          criteria.requiredCapabilities!.every((cap) => p.metadata.capabilities.includes(cap))
        );
      }

      // Filter by cost preference (fast check)
      if (criteria.preferFree) {
        const freeProviders = candidates.filter((p) =>
          p.metadata.costTier === ProviderCostTier.FREE || p.metadata.costTier === ProviderCostTier.FREEMIUM
        );
        if (freeProviders.length > 0) {
          candidates = freeProviders;
        }
      }

      // Filter by budget (requires async DB call - do this after cheaper filters)
      if (criteria.maxCostUsd) {
        candidates = await this.filterByBudget(candidates, criteria.maxCostUsd);
      }

      // Filter by health (cached, but still async)
      candidates = await this.filterByHealth(candidates);

      // Sort by task complexity match (final optimization)
      if (criteria.taskComplexity) {
        candidates = this.sortByTaskMatch(candidates, criteria.taskComplexity);
      }

      if (candidates.length === 0) {
        throw new Error("No suitable provider found for criteria");
      }

      const selectedProvider = candidates[0].metadata.name;

      // Record metrics
      this.recordSelectionMetrics("selectProvider", performance.now() - startTime);

      return selectedProvider;
    } catch (error) {
      // Record failed selection metrics
      this.recordSelectionMetrics("selectProvider", performance.now() - startTime);
      throw error;
    }
  }

  /**
   * Select provider for a specific task using configuration-driven strategy.
   * @param config Configuration with provider strategy
   * @param taskType Task type (simple, complex, etc.)
   * @returns The name of the selected provider
   * @throws Error if no suitable provider is found
   */
  async selectProviderForTask(config: Config, taskType: string): Promise<string> {
    const envProvider = await this.trySelectEnvProvider();
    if (envProvider) return envProvider;

    const strategy = config.provider_strategy;
    const routedProvider = await this.trySelectRoutedProvider(strategy, taskType);
    if (routedProvider) return routedProvider;

    const criteria = this.buildSelectionCriteria(strategy);
    const taskComplexity = this.mapTaskComplexity(taskType);
    if (taskComplexity) criteria.taskComplexity = taskComplexity;

    return this.selectProvider(criteria);
  }

  private async trySelectEnvProvider(): Promise<string | null> {
    const envOverrides = getValidatedEnvOverrides();
    const providerName = envOverrides.EXA_LLM_PROVIDER;
    if (!providerName) return null;

    const metadata = this.registry.getProviderMetadata(providerName);
    if (!metadata) {
      console.warn(
        `⚠️  Environment-specified provider '${providerName}' is not registered, falling back to intelligent selection`,
      );
      return null;
    }

    if (this.shouldBlockPaidProvider(metadata)) {
      console.warn(
        `⚠️  Environment-specified paid provider '${providerName}' blocked in test/CI environment. Set EXA_TEST_ENABLE_PAID_LLM=1 to enable. Falling back to intelligent selection`,
      );
      return null;
    }

    const isHealthy = await this.healthChecker.checkProvider(providerName);
    if (!isHealthy) {
      console.warn(
        `⚠️  Environment-specified provider '${providerName}' is not healthy, falling back to intelligent selection`,
      );
      return null;
    }

    return providerName;
  }

  private shouldBlockPaidProvider(metadata: { costTier?: ProviderCostTier; pricingTier?: PricingTier }): boolean {
    if (!this.isPaidProvider(metadata)) return false;
    if (!this.isTestOrCI()) return false;
    return !this.isPaidLLMEnabled();
  }

  private isPaidProvider(metadata: { costTier?: ProviderCostTier; pricingTier?: PricingTier }): boolean {
    const paidCostTiers = new Set<ProviderCostTier>([ProviderCostTier.PAID, ProviderCostTier.FREEMIUM]);
    const paidPricingTiers = new Set<PricingTier>([PricingTier.HIGH, PricingTier.MEDIUM, PricingTier.LOW]);
    if (metadata.costTier && paidCostTiers.has(metadata.costTier)) return true;
    if (metadata.pricingTier && paidPricingTiers.has(metadata.pricingTier)) return true;
    return false;
  }

  private isTestOrCI(): boolean {
    if (isTestMode()) return true;
    if (isCIMode()) return true;
    return false;
  }

  private isPaidLLMEnabled(): boolean {
    return Deno.env.get("EXA_TEST_ENABLE_PAID_LLM") === "1";
  }

  private async trySelectRoutedProvider(
    strategy: Config["provider_strategy"],
    taskType: string,
  ): Promise<string | null> {
    const routedProviders = strategy.task_routing?.[taskType];
    if (!routedProviders) return null;

    for (const providerName of routedProviders) {
      const metadata = this.registry.getProviderMetadata(providerName);
      if (!metadata) continue;
      const isHealthy = await this.healthChecker.checkProvider(providerName);
      if (isHealthy) return providerName;
    }

    return null;
  }

  private buildSelectionCriteria(strategy: Config["provider_strategy"]): ISelectionCriteria {
    return {
      preferFree: strategy.prefer_free,
      maxCostUsd: strategy.max_daily_cost_usd,
      allowLocal: strategy.allow_local,
      requiredCapabilities: ["chat"],
    };
  }

  private mapTaskComplexity(taskType: string): TaskComplexity | undefined {
    if (taskType === TaskComplexity.SIMPLE) return TaskComplexity.SIMPLE;
    if (taskType === TaskComplexity.COMPLEX) return TaskComplexity.COMPLEX;
    return undefined;
  }

  /**
   * Filter providers by budget constraints.
   */
  private async filterByBudget(
    providers: ProviderEntry[],
    maxCost: number,
  ): Promise<ProviderEntry[]> {
    const results = [];
    for (const p of providers) {
      const dailyCost = await this.costTracker.getDailyCost(p.metadata.name);
      if (dailyCost < maxCost) {
        results.push(p);
      }
    }
    return results;
  }

  /**
   * Filter providers by health status.
   */
  private async filterByHealth(
    providers: ProviderEntry[],
  ): Promise<ProviderEntry[]> {
    const results = [];
    for (const p of providers) {
      const isHealthy = await this.healthChecker.checkProvider(p.metadata.name);
      if (isHealthy) {
        results.push(p);
      }
    }
    return results;
  }

  /**
   * Sort providers by task complexity match.
   */
  private sortByTaskMatch(
    providers: ProviderEntry[],
    complexity: TaskComplexity,
  ): ProviderEntry[] {
    const tierPreference = {
      [TaskComplexity.SIMPLE]: [PricingTier.LOCAL, PricingTier.FREE, PricingTier.LOW],
      [TaskComplexity.MEDIUM]: [PricingTier.LOW, PricingTier.MEDIUM, PricingTier.FREE],
      [TaskComplexity.COMPLEX]: [PricingTier.HIGH, PricingTier.MEDIUM, PricingTier.LOW],
      [TaskComplexity.EPIC]: [PricingTier.HIGH, PricingTier.MEDIUM, PricingTier.LOW],
    };

    const preferred = tierPreference[complexity];
    return providers.sort((a, b) => {
      const aIndex = preferred.indexOf(a.metadata.pricingTier);
      const bIndex = preferred.indexOf(b.metadata.pricingTier);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });
  }

  /**
   * Record selection performance metrics.
   */
  private recordSelectionMetrics(operation: string, durationMs: number): void {
    const key = operation;
    const existing = this.selectionMetrics.get(key);

    if (existing) {
      existing.count++;
      existing.totalTime += durationMs;
      existing.avgTime = existing.totalTime / existing.count;
    } else {
      this.selectionMetrics.set(key, {
        count: 1,
        totalTime: durationMs,
        avgTime: durationMs,
      });
    }
  }

  /**
   * Get selection performance metrics.
   */
  getSelectionMetrics(): Record<string, { count: number; totalTime: number; avgTime: number }> {
    return Object.fromEntries(this.selectionMetrics);
  }

  /**
   * Reset selection metrics (useful for testing).
   */
  resetMetrics(): void {
    this.selectionMetrics.clear();
  }
}
