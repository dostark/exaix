/**
 * @module JudgeAgentRunner
 * @path apps/daemon/src/judge_agent_runner.ts
 * @description Minimal IAgentRunner for GateEvaluator/JudgeEvaluator: sends the
 *   evaluation prompt straight to the model provider, bypassing the full
 *   AgentOrchestrator (worktree, tools, skills) a gate evaluation does not need.
 * @architectural-layer Application
 * @dependencies [@exaix/ai, @exaix/flow]
 * @related-files [apps/daemon/main.ts, packages/flow/src/judge_evaluator.ts, packages/flow/src/gate_evaluator.ts]
 */

import type { IModelProvider } from "@exaix/ai";
import type { IAgentContext, IAgentRunner } from "@exaix/flow/judge_evaluator.ts";

export class JudgeAgentRunner implements IAgentRunner {
  constructor(private readonly provider: IModelProvider) {}

  async run(
    _identityId: string,
    request: { userPrompt: string; context?: IAgentContext },
  ): Promise<{ content: string }> {
    const result = await this.provider.generate(request.userPrompt);
    return { content: result.content };
  }
}
