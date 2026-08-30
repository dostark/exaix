/**
 * @module StrategyRegistry
 * @path packages/execution/src/strategies/strategy_registry.ts
 * @description Central registry for managing and resolving agent execution strategies.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_orchestrator.ts, packages/execution/src/strategies/execution_strategy.ts]
 */

import type { IExecutionStrategy } from "./execution_strategy.ts";

/**
 * Registry for agent execution strategies
 */
export class StrategyRegistry {
  private strategies: Map<string, IExecutionStrategy> = new Map();

  /**
   * Register a new strategy
   */
  register(strategy: IExecutionStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  /** Resolve a strategy by name. @throws Error if not found. */
  resolve(name: string): IExecutionStrategy {
    const strategy = this.strategies.get(name);
    if (!strategy) {
      throw new Error(`Execution strategy not found: ${name}`);
    }
    return strategy;
  }

  /**
   * List all registered strategy names
   */
  list(): string[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Get all registered strategies
   */
  all(): IExecutionStrategy[] {
    return Array.from(this.strategies.values());
  }
}
