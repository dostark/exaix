/**
 * @module ReActLoopAdapter
 * @path packages/execution/src/react_loop_adapter.ts
 * @description Adapter that implements IReActLoopExecutor by composing
 *   AgentExecutor's extracted services. Breaks the structural coupling
 *   between AgentExecutor and the ReAct loop strategy.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_executor.ts]
 */

import type { JSONValue } from "@exaix/core";
import type { IEventBusService } from "@exaix/core/observability";
import type { IEventLogger } from "@exaix/core/logger";
import {
  ActorType,
  AGENT_EVENT_OUTPUT,
  AGENT_GENERATION_COMPLETED,
  AgentKind,
  DEFAULT_MCP_IDENTITY_ID,
} from "@exaix/core";
import type { IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_executor.ts";
import type { IPromptBudget } from "@exaix/schemas/prompt_budget.ts";
import type { IToolRegistry } from "@exaix/core/types";
import type { IContextBudgetManager } from "./context/context_budget_manager.ts";
import type { IGuardrailRunner } from "./guardrail_runner.ts";
import type { IOutputParserContext, OutputParser } from "./output_parser.ts";
import type { ExecutionContextService } from "./execution_context_service.ts";
import type { Opt, Reason } from "@exaix/core/types";

/**
 * Interface that the ReAct loop strategy requires from its executor.
 * Previously used AgentExecutor["methodName"] type-queries, creating
 * structural coupling. Now an independent interface.
 */
export interface IReActLoopExecutor {
  logAgentOutput(traceId: string, output: string): Promise<void>;
  validateReviewResult(result: JSONValue): IChangesetResult;
  parseAgentResponse(response: string, context: IOutputParserContext, startTime: number): IChangesetResult;
  toolRegistry: IToolRegistry | undefined;
  logGeneration(
    traceId: string,
    identityId: string,
    model: string,
    providerStr: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
    costUsd: number,
  ): Promise<void>;
  eventBus?: IEventBusService;
  contextBudgetManager?: IContextBudgetManager;
  currentPromptBudget?: IPromptBudget;
  budgetLogger?: IEventLogger;
  guardrailRunner?: IGuardrailRunner;
}

/**
 * Adapter that implements IReActLoopExecutor by composing AgentExecutor's services.
 */
export class ReActLoopAdapter implements IReActLoopExecutor {
  constructor(
    private outputParser: OutputParser,
    private ctx: ExecutionContextService,
    private logger: IEventLogger,
    public toolRegistry?: Opt<IToolRegistry, Reason.OptionalDependency>,
    public eventBus?: Opt<IEventBusService, Reason.OptionalDependency>,
    public guardrailRunner?: Opt<IGuardrailRunner, Reason.OptionalDependency>,
  ) {}

  get contextBudgetManager(): IContextBudgetManager | undefined {
    return this.ctx.contextBudgetManager;
  }

  get currentPromptBudget(): IPromptBudget | undefined {
    return this.ctx.currentPromptBudget;
  }

  get budgetLogger(): IEventLogger {
    return this.logger;
  }

  async logAgentOutput(traceId: string, output: string): Promise<void> {
    await this.logger.info(AGENT_EVENT_OUTPUT, "subprocess", { output }, traceId);
  }

  validateReviewResult(result: JSONValue): IChangesetResult {
    return this.outputParser.validateReviewResult(result);
  }

  parseAgentResponse(
    response: string,
    context: IOutputParserContext,
    startTime: number,
  ): IChangesetResult {
    return this.outputParser.parseAgentResponse(response, context, startTime);
  }

  async logGeneration(
    traceId: string,
    identityId: string,
    model: string,
    providerStr: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
    costUsd: number,
  ): Promise<void> {
    await this.logger.log({
      action: AGENT_GENERATION_COMPLETED,
      target: model,
      actor: DEFAULT_MCP_IDENTITY_ID,
      actorType: ActorType.SERVICE,
      traceId,
      agentId: "agent-executor",
      agentKind: AgentKind.AGENT_EXECUTOR,
      identityId,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd,
      payload: {
        model,
        provider: providerStr,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
        cost_usd: costUsd,
      },
    });
  }
}
