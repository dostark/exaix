/**
 * @module AgentStepHandler
 * @path packages/flow/src/step_handlers/agent_step_handler.ts
 * @description IFlowStepHandler for AGENT step type — extracted from flow_runner.ts
 * executeAgentStep, executeDynamicStep, and executeDeclaredStep.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/step_handlers/step_handler.ts, packages/flow/src/flow_runner.ts]
 */

import type { IFlowStepHandler, IStepExecutionContext } from "./step_handler.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { IAgentExecutor, IFlowStepRequest } from "../flow_runner.ts";
import type { DynamicStepExecutor } from "../dynamic_step_executor.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { IBlueprintFrontmatter } from "@exaix/schemas/blueprint.ts";
import { FlowStepExecutionMode } from "@exaix/core";
import { IBlueprintLoader } from "@exaix/core/blueprint";
import { join } from "@std/path";

export interface IAgentStepHandlerDeps {
  agentExecutor: IAgentExecutor;
  dynamicStepExecutor?: DynamicStepExecutor;
  config?: Config;
}

export class AgentStepHandler implements IFlowStepHandler {
  readonly stepType = "agent";

  readonly #agentExecutor: IAgentExecutor;
  readonly #dynamicStepExecutor?: DynamicStepExecutor;
  readonly #config?: Config;

  constructor(deps: IAgentStepHandlerDeps) {
    this.#agentExecutor = deps.agentExecutor;
    this.#dynamicStepExecutor = deps.dynamicStepExecutor;
    this.#config = deps.config;
  }

  async execute(ctx: IStepExecutionContext): Promise<IAgentExecutionResult> {
    const { step, request, stepRequest } = ctx;

    if (step.execution_mode === FlowStepExecutionMode.DYNAMIC && this.#dynamicStepExecutor) {
      return await this.#executeDynamic(step, request, stepRequest);
    }
    if (step.strategy) {
      return await this.#executeWithStrategy(step, stepRequest);
    }
    return await this.#executeDeclared(step, stepRequest);
  }

  async #executeDynamic(
    step: IStepExecutionContext["step"],
    request: IStepExecutionContext["request"],
    stepRequest: IStepExecutionContext["stepRequest"],
  ): Promise<IAgentExecutionResult> {
    const blueprintsPath = this.#config
      ? join(this.#config.system.root, this.#config.paths.blueprints, this.#config.paths.agents)
      : "";
    const loader = new IBlueprintLoader({ blueprintsPath });
    const loaded = await loader.load(step.agent_role);

    if (!loaded) {
      throw new Error(`Blueprint not found for dynamic step: ${step.agent_role}`);
    }

    const dynamicResult = await this.#dynamicStepExecutor!.execute(
      step,
      loaded.frontmatter as IBlueprintFrontmatter,
      stepRequest.userPrompt,
      { traceId: request.traceId || crypto.randomUUID() },
    );

    return {
      thought: `Dynamic execution completed in ${dynamicResult.iterations} iterations`,
      content: dynamicResult.output,
      raw: JSON.stringify(dynamicResult.toolCallsLog),
    };
  }

  async #executeDeclared(
    step: IStepExecutionContext["step"],
    stepRequest: IStepExecutionContext["stepRequest"],
  ): Promise<IAgentExecutionResult> {
    return await this.#agentExecutor.run(step.agent_role, stepRequest as IFlowStepRequest);
  }

  /** Routes a DECLARED step that declares `strategy` through `IAgentExecutor.runWithStrategy`,
   *  bypassing the single-shot `run()` path. Fails fast when unsupported, rather than
   *  silently falling back. */
  async #executeWithStrategy(
    step: IStepExecutionContext["step"],
    stepRequest: IStepExecutionContext["stepRequest"],
  ): Promise<IAgentExecutionResult> {
    if (!this.#agentExecutor.runWithStrategy) {
      throw new Error(
        `Step '${step.id}' declares strategy '${step.strategy}' but the configured agent executor does not support runWithStrategy`,
      );
    }
    return await this.#agentExecutor.runWithStrategy(
      step.agent_role,
      stepRequest as IFlowStepRequest,
      step.strategy!,
    );
  }
}
