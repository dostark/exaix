/**
 * @module ExecutionStrategy
 * @path packages/execution/src/strategies/execution_strategy.ts
 * @description Interface for agent execution strategies, including the optional
 * `dispose?()` lifecycle contract for strategies that manage external resources.
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/strategy_registry.ts, packages/execution/src/agent_composer.ts]
 * Allows different execution models (ReAct, MCP, etc.) to be used interchangeably.
 */

import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { Opt, Reason } from "@exaix/core/types";
import type { IAgentFileBlueprint } from "../agent_composer.ts";
import type { IPinnedSkillPrompt } from "../skill_pin_transport.ts";

export interface IExecutionStrategy {
  readonly name: string;

  execute(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
    pinnedSkills?: Opt<IPinnedSkillPrompt | null, Reason.OptionalContext>,
  ): Promise<IChangesetResult>;

  /** Optional — only implement when the strategy holds external resources (signal
   *  listeners, subprocess handles). Callers use `strategy.dispose?.()`. */
  dispose?(): void;
}
