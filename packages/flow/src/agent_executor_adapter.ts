/**
 * @module AgentOrchestratorAdapter
 * @path packages/flow/src/agent_executor_adapter.ts
 * @description Bridges IAgentRunner into FlowRunner's IAgentExecutor interface.
 * Loads blueprints by identityId and converts IFlowStepRequest to IParsedRequest
 * before delegating to IAgentRunner.run().
 * @architectural-layer Flows
 * @dependencies ["@exaix/execution", "@exaix/core"]
 * @related-files ["packages/flow/src/flow_runner.ts", "packages/execution/src/agent_runner.ts"]
 */

import type { IAgentExecutionResult, IBlueprint } from "@exaix/execution";
import { IBlueprintLoader } from "@exaix/core/blueprint";
import type { IFlowStepRequest } from "./flow_runner.ts";
import type { JSONValue } from "@exaix/core";

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
 * Minimal runner interface matching the subset of IAgentRunner used by the adapter.
 */
export interface IRunner {
  run(
    blueprint: IBlueprint,
    request: IParsedRequest,
    jsonSchema?: Record<string, JSONValue>,
  ): Promise<IAgentExecutionResult>;
}

/**
 * Adapter that wraps an IAgentRunner (or compatible IRunner) into FlowRunner's
 * IAgentExecutor interface. Loads blueprints by identityId and maps request types.
 */
export class AgentOrchestratorAdapter {
  private loader: IBlueprintLoader;

  constructor(
    private runner: IRunner,
    blueprintsPath: string,
  ) {
    this.loader = new IBlueprintLoader({ blueprintsPath });
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

    return await this.runner.run(blueprint, parsedRequest, undefined);
  }
}
