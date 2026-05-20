/**
 * @module ExecutionStrategy
 * @path packages/execution/src/strategies/execution_strategy.ts
 * @description Interface for agent execution strategies, including the optional
 * `dispose?()` lifecycle contract for strategies that manage external resources.
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/strategy_registry.ts, packages/execution/src/agent_executor.ts]
 * Allows different execution models (ReAct, MCP, etc.) to be used interchangeably.
 */

import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_executor.ts";
import type { IAgentFileBlueprint } from "../agent_executor.ts";

/**
 * Interface for agent execution strategies.
 *
 * Lifecycle:
 * - `execute()` — perform the agent step and return a changeset result.
 * - `dispose?()` — optional cleanup for strategies that hold external resources
 *   (e.g. signal listeners, subprocess handles). Call via `strategy.dispose?.()` to
 *   safely skip strategies that do not implement it.
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

  /**
   * Release resources held by this strategy (signal listeners, subprocess handles, etc.).
   * Optional — only implement when the strategy manages external resources.
   * Callers should use `strategy.dispose?.()` to safely handle absent implementations.
   */
  dispose?(): void;
}
