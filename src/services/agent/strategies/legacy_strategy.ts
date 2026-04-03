/**
 * @module LegacyAgentStrategy
 * @path src/services/agent/strategies/legacy_strategy.ts
 * @description Sub-agent execution through direct model generation (simulated tasks).
 * @architectural-layer Services
 * @related-files [src/services/agent/agent_executor.ts, src/services/agent/strategies/execution_strategy.ts]
 */

import { IExecutionStrategy } from "./execution_strategy.ts";
import { AgentExecutor, IAgentFileBlueprint } from "../agent_executor.ts";
import { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "../../../shared/schemas/agent_executor.ts";
import { IModelProvider } from "../../../ai/types.ts";

/**
 * Legacy execution strategy that uses direct LLM generation (simulation)
 */
export class LegacyAgentStrategy implements IExecutionStrategy {
  public readonly name = "legacy";

  constructor(
    private executor: AgentExecutor,
    private provider?: IModelProvider,
  ) {}

  async execute(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
  ): Promise<IChangesetResult> {
    const startTime = Date.now();

    if (this.provider) {
      // Use the logic from AgentExecutor
      const prompt = this.executor.buildExecutionPrompt(blueprint, context, options);
      const response = await this.provider.generate(prompt, {
        temperature: 0.7,
        max_tokens: 4000,
      });

      // Use public wrappers from AgentExecutor
      const result = this.executor.parseAgentResponse(response, context, startTime);
      return this.executor.validateReviewResult(result);
    }

    // Fallback mock result
    return {
      branch: `feat/${context.request_id}-${context.trace_id.slice(0, 8)}`,
      commit_sha: "abc1234567890abcdef",
      files_changed: [],
      description: context.plan,
      tool_calls: 0,
      execution_time_ms: Date.now() - startTime,
    };
  }
}
