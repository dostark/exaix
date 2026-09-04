/**
 * @module ReActLoopAdapter
 * @path packages/execution/src/react_loop_adapter.ts
 * @description Adapter that implements IReActLoopExecutor by composing
 *   AgentOrchestrator's extracted services. Breaks the structural coupling
 *   between AgentOrchestrator and the ReAct loop strategy.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_orchestrator.ts]
 */

import type { JSONValue } from "@exaix/core";
import type { IEventBusService } from "@exaix/core/observability";
import type { IEventLogger } from "@exaix/core/logger";
import { ActorType, AGENT_GENERATION_COMPLETED, DEFAULT_MCP_AGENT_ROLE_ID, RunnerKind } from "@exaix/core";
import { DEFAULT_AGENT_ACI_DOC_PROMPT_MAX_CHARS } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import type { IAgentPromptAssembledReactPayload } from "@exaix/core/events";
import type { IChangesetResult } from "@exaix/schemas/agent_orchestrator.ts";
import type { IPromptBudget } from "@exaix/schemas/prompt_budget.ts";
import type { IToolRegistry } from "@exaix/core/types";
import type { IContextBudgetManager } from "./context/context_budget_manager.ts";
import type { IGuardrailRunner } from "./guardrail_runner.ts";
import type { IOutputParserContext, OutputParser } from "./output_parser.ts";
import type { ExecutionContextService } from "./execution_context_service.ts";
import type { Opt, Reason } from "@exaix/core/types";

/** Interface the ReAct loop strategy requires from its executor, decoupled from AgentOrchestrator's internal types. */
export interface IReActLoopExecutor {
  logAgentOutput(traceId: string, output: string): Promise<void>;
  /** Journals a dynamic_tool_call event, matching DynamicStepExecutor; optional since test
   *  doubles need not implement it. */
  logDynamicToolCall?(
    traceId: string,
    tool: string,
    args: Record<string, JSONValue>,
    resultSummary: string,
    iteration: number,
  ): Promise<void>;
  validateReviewResult(result: JSONValue): IChangesetResult;
  parseAgentResponse(response: string, context: IOutputParserContext, startTime: number): IChangesetResult;
  toolRegistry?: Opt<IToolRegistry, Reason.OptionalDependency>;
  logGeneration(
    traceId: string,
    agentRole: string,
    model: string,
    providerStr: string,
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      costUsd: number;
      durationMs?: Opt<number, Reason.OptionalInput>;
    },
  ): Promise<void>;
  eventBus?: IEventBusService;
  contextBudgetManager?: IContextBudgetManager;
  currentPromptBudget?: IPromptBudget;
  budgetLogger?: IEventLogger;
  guardrailRunner?: IGuardrailRunner;
  /** Whether ACI tool guidance is injected into the ReAct execution prompt. */
  readonly aciDocsEnabled?: boolean;
  /** The configured aggregate ACI prompt-injection character budget. */
  readonly aciDocPromptMaxChars?: number;
  /** `target` is `context.request_id`. Optional since test doubles need not implement it. */
  logPromptAssembled?(
    traceId: string,
    target: string,
    payload: IAgentPromptAssembledReactPayload,
  ): Promise<void>;
}

/** ACI tool-guidance options, nested inside IReActLoopAdapterOptions. */
export interface IReActLoopAdapterAciOptions {
  /** Whether ACI tool guidance is injected into the ReAct execution prompt. */
  enabled?: boolean;
  /** The configured aggregate ACI prompt-injection character budget. */
  promptMaxChars?: number;
}

/** Trailing optional-dependency bundle for ReActLoopAdapter's constructor, kept as one
 * parameter object so the constructor stays within the project's 7-parameter limit. */
export interface IReActLoopAdapterOptions {
  eventBus?: Opt<IEventBusService, Reason.OptionalDependency>;
  guardrailRunner?: Opt<IGuardrailRunner, Reason.OptionalDependency>;
  aci?: IReActLoopAdapterAciOptions;
}

/** Adapter that implements IReActLoopExecutor by composing AgentOrchestrator's services.
 * @visible
 */
export class ReActLoopAdapter implements IReActLoopExecutor {
  public readonly eventBus?: IEventBusService;
  public readonly guardrailRunner?: IGuardrailRunner;
  public readonly aciDocsEnabled: boolean;
  public readonly aciDocPromptMaxChars: number;

  constructor(
    private outputParser: OutputParser,
    private ctx: ExecutionContextService,
    private logger: IEventLogger,
    public toolRegistry?: Opt<IToolRegistry, Reason.OptionalDependency>,
    options?: Opt<IReActLoopAdapterOptions, Reason.OptionalInput>,
  ) {
    this.eventBus = options?.eventBus;
    this.guardrailRunner = options?.guardrailRunner;
    this.aciDocsEnabled = options?.aci?.enabled ?? false;
    this.aciDocPromptMaxChars = options?.aci?.promptMaxChars ?? DEFAULT_AGENT_ACI_DOC_PROMPT_MAX_CHARS;
  }

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
    await this.logger.info(DomainEventType.AgentOutput, "subprocess", { output }, traceId);
  }

  async logDynamicToolCall(
    traceId: string,
    tool: string,
    args: Record<string, JSONValue>,
    resultSummary: string,
    iteration: number,
  ): Promise<void> {
    await this.logger.info(
      DomainEventType.AgentDynamicToolCall,
      "subprocess",
      { tool, args, resultSummary, iteration },
      traceId,
    );
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
    agentRole: string,
    model: string,
    providerStr: string,
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      costUsd: number;
      durationMs?: Opt<number, Reason.OptionalInput>;
    },
  ): Promise<void> {
    await this.logger.log({
      action: AGENT_GENERATION_COMPLETED,
      target: model,
      actor: DEFAULT_MCP_AGENT_ROLE_ID,
      actorType: ActorType.SERVICE,
      traceId,
      runnerId: "agent-composer",
      runnerKind: RunnerKind.AGENT_COMPOSER,
      agentRole,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: usage.costUsd,
      payload: {
        model,
        provider: providerStr,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
        cost_usd: usage.costUsd,
        duration_ms: usage.durationMs,
      },
    });
  }

  async logPromptAssembled(
    traceId: string,
    target: string,
    payload: IAgentPromptAssembledReactPayload,
  ): Promise<void> {
    await this.logger.info(DomainEventType.AgentPromptAssembled, target, { ...payload }, traceId);
  }
}
