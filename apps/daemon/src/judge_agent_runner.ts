/**
 * @module JudgeAgentRunner
 * @path apps/daemon/src/judge_agent_runner.ts
 * @description Minimal IAgentRunner for GateEvaluator/JudgeEvaluator: sends the
 *   evaluation prompt straight to the model provider, bypassing the full
 *   AgentComposer (worktree, tools, skills) a gate evaluation does not need.
 *   With a bindingService, a flow-gate judge carrying bindingContext resolves the
 *   gate's bound provider and the snapshot's effective effort/thinking; non-flow
 *   callers (no bindingContext) keep the boot provider.
 * @architectural-layer Application
 * @dependencies [@exaix/ai, @exaix/flow]
 * @related-files [apps/daemon/main.ts, packages/flow/src/judge_evaluator.ts, packages/flow/src/gate_evaluator.ts]
 */

import type { IModelOptions, IModelProvider } from "@exaix/ai";
import { BOUND_TARGET_KIND_PROVIDER, type ModelBindingService } from "@exaix/ai";
import { EFFORT_AUTO } from "@exaix/schemas";
import type { IAgentContext, IAgentRunner } from "@exaix/flow/judge_evaluator.ts";
import type { IBindingGateContext } from "@exaix/schemas";
import type { IFlowJudgeCallMetadata, Opt, Reason } from "@exaix/core/types";

export class JudgeAgentRunner implements IAgentRunner {
  constructor(
    private readonly provider: IModelProvider,
    private readonly bindingService?: Opt<ModelBindingService, Reason.OptionalDependency>,
  ) {}

  async run(
    _agentRole: string,
    request: {
      userPrompt: string;
      context?: IAgentContext;
      bindingContext?: IBindingGateContext;
      callMetadata?: IFlowJudgeCallMetadata;
    },
  ): Promise<{ content: string }> {
    const bound = request.bindingContext && this.bindingService
      ? await this.bindingService.providerFor(request.bindingContext.snapshot, request.bindingContext.stepRef)
      : undefined;
    const provider = bound?.kind === BOUND_TARGET_KIND_PROVIDER ? bound.provider : this.provider;
    const generateOptions: IModelOptions | undefined = bound?.kind === BOUND_TARGET_KIND_PROVIDER
      ? {
        ...(bound.binding.effort !== undefined && bound.binding.effort !== EFFORT_AUTO
          ? { effort: bound.binding.effort }
          : {}),
        ...(bound.binding.thinking !== undefined && bound.binding.thinking !== EFFORT_AUTO
          ? { thinking: bound.binding.thinking === true }
          : {}),
      }
      : undefined;
    const criteria: string[] = [];
    if (Array.isArray(request.context?.criteria)) {
      for (const criterion of request.context.criteria) {
        if (typeof criterion === "string") criteria.push(criterion);
      }
    }
    const result = await provider.generate(request.userPrompt, {
      ...generateOptions,
      traceId: request.callMetadata?.traceId,
      callSite: request.callMetadata?.callSite,
      responseContract: { kind: "judge-json", criteria },
    });
    return { content: result.content };
  }
}
