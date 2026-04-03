/**
 * @module ExecutionStrategy
 * @path src/services/agent/strategies/execution_strategy.ts
 * @description Interface for agent execution strategy.
 * @architectural-layer Services
 * @related-files [src/services/agent/agent_executor.ts, src/services/agent/strategies/strategy_registry.ts]
 * Allows different execution models (ReAct, MCP, etc.) to be used interchangeably.
 */

import { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "../../../shared/schemas/agent_executor.ts";
import { IAgentFileBlueprint } from "../agent_executor.ts";

/**
 * Interface for agent execution strategies
 */
export interface IExecutionStrategy {
  /**
   * Unique name of the strategy
   */
  readonly name: string;

  /**
   * Execute a single step using this strategy
   *
   * @param blueprint - The agent blueprint to use
   * @param context - Execution context (request, plan, etc.)
   * @param options - Execution options (portal, identity, etc.)
   * @returns Result of the execution
   */
  execute(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
  ): Promise<IChangesetResult>;
}
