/**
 * @module ExecutionStrategy
 * @path packages/execution/src/strategies/execution_strategy.ts
 * @description Interface for agent execution strategies, including the optional
 * `dispose?()` lifecycle contract for strategies that manage external resources.
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/strategy_registry.ts, packages/execution/src/agent_orchestrator.ts]
 * Allows different execution models (ReAct, MCP, etc.) to be used interchangeably.
 */

import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
import type { IAgentFileBlueprint } from "../agent_orchestrator.ts";

export interface IExecutionStrategy {
  readonly name: string;

  execute(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
  ): Promise<IChangesetResult>;

  /** Optional — only implement when the strategy holds external resources (signal
   *  listeners, subprocess handles). Callers use `strategy.dispose?.()`. */
  dispose?(): void;
}
