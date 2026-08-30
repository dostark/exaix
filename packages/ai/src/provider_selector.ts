/**
 * @module ProviderSelector
 * @path packages/ai/src/provider_selector.ts
 * @description Provider selection facade. Delegates the routing decision to an injectable
 * IProviderRoutingStrategy (Phase 115 Step 2) — Solo uses DefaultRoutingStrategy, paid editions
 * inject an advanced strategy via the edition composer — while owning selection-timing metrics.
 * @architectural-layer AI
 * @related-files [packages/ai/src/provider_registry.ts, packages/ai/src/routing/default_routing_strategy.ts, packages/ai/src/routing/provider_routing_strategy.ts]
 */

import type { ProviderRegistry } from "./provider_registry.ts";
import type { ICostTracker } from "@exaix/core";
import type { Config } from "@exaix/schemas";
import type { TaskComplexity } from "@exaix/core";

import { DefaultRoutingStrategy } from "./routing/default_routing_strategy.ts";
import type { IProviderRoutingStrategy } from "./routing/provider_routing_strategy.ts";
import type { Opt, Reason } from "@exaix/core/types";

/**
 * Local interface for HealthCheckService dependency to respect boundary
 */
export interface IProviderHealthChecker {
  checkProvider(providerName: string): Promise<boolean>;
}

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
  /** Scoring hints — "cheapest", "fastest", etc. Weighted blend in ModelResolver. */
  characteristics?: string[];
  /** Rate-limit headroom influence weight (0-1); 0 = disabled. */
  rateLimitWeight?: number;
}

/** Delegates provider selection to a routing strategy and records timing metrics. */
export class ProviderSelector {
  private selectionMetrics = new Map<string, { count: number; totalTime: number; avgTime: number }>();
  private readonly strategy: IProviderRoutingStrategy;

  constructor(
    registry: typeof ProviderRegistry,
    costTracker: ICostTracker,
    healthChecker: IProviderHealthChecker,
    strategy?: Opt<IProviderRoutingStrategy, Reason.OptionalDependency>,
  ) {
    // Default-wire the historical routing; a paid edition injects an alternative strategy.
    this.strategy = strategy ?? new DefaultRoutingStrategy(registry, costTracker, healthChecker);
  }

  /** Selects the optimal provider based on the given criteria; throws if none is suitable. */
  async selectProvider(criteria: ISelectionCriteria): Promise<string> {
    const startTime = performance.now();
    try {
      return await this.strategy.selectProvider(criteria);
    } finally {
      this.recordSelectionMetrics("selectProvider", performance.now() - startTime);
    }
  }

  /** Selects a provider for a task using the config-driven strategy; throws if none is suitable. */
  async selectProviderForTask(config: Config, taskType: string): Promise<string> {
    const startTime = performance.now();
    try {
      return await this.strategy.selectProviderForTask(config, taskType);
    } finally {
      this.recordSelectionMetrics("selectProviderForTask", performance.now() - startTime);
    }
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
