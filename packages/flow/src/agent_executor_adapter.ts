/**
 * @module AgentExecutorAdapter
 * @path packages/flow/src/agent_executor_adapter.ts
 * @description Bridges AgentRunner into FlowRunner's IAgentExecutor interface.
 * Loads blueprints by identityId and converts IFlowStepRequest to IParsedRequest
 * before delegating to AgentRunner.run().
 * @architectural-layer Flows
 * @dependencies ["@exaix/execution", "@exaix/core"]
 * @related-files ["packages/flow/src/flow_runner.ts", "packages/execution/src/agent_runner.ts"]
 */

import type { IAgentExecutionResult, IBlueprint } from "@exaix/execution";
import { BlueprintLoader } from "@exaix/core/blueprint";
import type { IFlowStepRequest } from "./flow_runner.ts";

/**
 * Minimal request context type for converting IFlowStepRequest to IParsedRequest.
 */
interface IRequestContextContext {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | IRequestContextContext
    | (string | number | boolean | null | undefined | IRequestContextContext)[]
    | string[];
}

interface IParsedRequest {
  userPrompt: string;
  context: IRequestContextContext;
  requestId?: string;
  traceId?: string;
}

/**
 * Minimal runner interface matching the subset of AgentRunner used by the adapter.
 */
export interface IRunner {
  run(blueprint: IBlueprint, request: IParsedRequest): Promise<IAgentExecutionResult>;
}

/**
 * Adapter that wraps an AgentRunner (or compatible IRunner) into FlowRunner's
 * IAgentExecutor interface. Loads blueprints by identityId and maps request types.
 */
export class AgentExecutorAdapter {
  private loader: BlueprintLoader;

  constructor(
    private runner: IRunner,
    blueprintsPath: string,
  ) {
    this.loader = new BlueprintLoader({ blueprintsPath });
  }

  async run(identityId: string, request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    const loaded = await this.loader.load(identityId);
    if (!loaded) {
      throw new Error(`Blueprint not found for identity: ${identityId}`);
    }

    const blueprint: IBlueprint = {
      systemPrompt: loaded.systemPrompt,
      identityId: loaded.identityId,
    };
    const parsedRequest: IParsedRequest = {
      userPrompt: request.userPrompt,
      context: (request.context ?? {}) as IRequestContextContext,
      requestId: request.requestId,
      traceId: request.traceId,
    };

    return await this.runner.run(blueprint, parsedRequest);
  }
}
