/**
 * @module ReActJournal
 * @path packages/execution/src/strategies/react_journal.ts
 * @description The journal rows and the heartbeat of the ReAct loop: truncated and refused answers, prompt assembly, generation, parse errors and executed actions.
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/execution/src/react_loop_adapter.ts]
 */

import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { ToolCallEntryPoint } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { IStreamingEvent } from "@exaix/schemas/streaming_event.ts";
import { DomainEventType, type IToolAliasRewrittenPayload } from "@exaix/core/events";
import {
  AGENT_EVENT_RESPONSE_REFUSED,
  AGENT_EVENT_RESPONSE_TRUNCATED,
  EXECUTION_HEARTBEAT_INTERVAL_MS,
  REACT_EVENT_ACTION_PARSE_FAILED,
  REACT_TOOL_RESULT_SUMMARY_MAX,
  RESPONSE_STOP_REASON_MAX_TOKENS,
  RESPONSE_STOP_REASON_REFUSAL,
  STREAMING_EVENT_HEARTBEAT,
} from "@exaix/core";
import type { IReActLoopExecutor } from "../react_loop_adapter.ts";
import { computeRegistryPredictedCost } from "../registry_computed_cost.ts";
import { ProviderRegistry, readProviderModelInfo } from "@exaix/ai";
import type { canonicalizeForRegistry, IAciRenderResult } from "@exaix/tool-runtime";
import type { IReActAction } from "./react_loop_types.ts";

/** The journal rows and heartbeat of one ReAct strategy: truncation, refusal, prompt assembly, generation and actions. */
export class ReActJournal {
  constructor(
    private readonly executor: IReActLoopExecutor,
    private readonly provider: Opt<IModelProvider, Reason.OptionalDependency>,
  ) {}

  /** Log a warning when the response was truncated at max_tokens. */
  logMaxTokensTruncation(
    response: IGenerateResult,
    options: IAgentExecutionOptions,
    iteration: number,
    context: IExecutionContext,
  ): void {
    if (response.stop_reason !== RESPONSE_STOP_REASON_MAX_TOKENS) return;
    void this.executor.budgetLogger?.warn(
      AGENT_EVENT_RESPONSE_TRUNCATED,
      context.request_id ?? null,
      {
        agent_role: options.agent_role ?? "",
        iteration,
        stop_reason: response.stop_reason,
        response_length: response.content.length,
        completion_tokens: response.usage.completionTokens,
      },
      context.trace_id,
    );
  }

  /** Log a warning when the model refused the request, so the empty answer is attributable to the refusal. */
  logRefusal(
    response: IGenerateResult,
    options: IAgentExecutionOptions,
    iteration: number,
    context: IExecutionContext,
  ): void {
    if (response.stop_reason !== RESPONSE_STOP_REASON_REFUSAL) return;
    void this.executor.budgetLogger?.warn(
      AGENT_EVENT_RESPONSE_REFUSED,
      context.request_id ?? null,
      {
        agent_role: options.agent_role ?? "",
        iteration,
        stop_reason: response.stop_reason,
        response_length: response.content.length,
      },
      context.trace_id,
    );
  }

  /** Journals prompt_assembled just before the provider call, once per iteration when ACI is enabled. */
  async emitPromptAssembledEvent(
    context: IExecutionContext,
    iteration: number,
    aciSection: Opt<{ result: IAciRenderResult; budgetChars: number }, Reason.OptionalContext>,
  ): Promise<void> {
    if (!this.executor.aciDocsEnabled || !this.executor.logPromptAssembled) return;
    await this.executor.logPromptAssembled(context.trace_id, context.request_id, {
      prompt_kind: "react",
      iteration,
      toolIds: aciSection?.result.toolIds ?? [],
      fragmentCount: aciSection?.result.fragmentCount ?? 0,
      fragmentChars: aciSection?.result.fragmentChars ?? 0,
      budgetChars: aciSection?.budgetChars ?? 0,
      truncated: aciSection?.result.truncated ?? false,
    });
  }

  async logIterationGeneration(
    response: IGenerateResult,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
    generateDurationMs: number,
  ): Promise<number | undefined> {
    const metadata = ProviderRegistry.getMetadataForInstance(this.provider?.id) ??
      ProviderRegistry.getMetadataForInstance(response.provider);
    const canPredict = response.costStatus === undefined ||
      (response.costStatus === "unknown" && metadata?.isAggregator === true);
    const price = canPredict ? await readProviderModelInfo(metadata, response.model) : undefined;
    const registryCostUsd = canPredict
      ? computeRegistryPredictedCost(response.provider, response.model, {
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        cacheReadTokens: response.usage.cacheReadTokens,
        cacheCreationTokens: response.usage.cacheCreationTokens,
      }, price)
      : undefined;
    const costUsd = response.costStatus === "unknown"
      ? registryCostUsd
      : response.costStatus !== undefined
      ? response.cost_usd
      : registryCostUsd ?? response.cost_usd ?? 0;

    await this.executor.logGeneration(
      context.trace_id,
      options.agent_role ?? "",
      response.model,
      response.provider,
      {
        ...response.usage,
        costUsd,
        ...(response.costStatus !== undefined
          ? { costSource: costUsd === undefined ? "unknown" as const : "predicted" as const }
          : {}),
        durationMs: generateDurationMs,
      },
    );

    return costUsd;
  }

  /** Journal each dropped-action TOML parse error so a vanished action is attributable. */
  journalParseErrors(parseErrors: string[], context: IExecutionContext, iteration: number): void {
    for (const parseError of parseErrors) {
      void this.executor.budgetLogger?.warn(
        REACT_EVENT_ACTION_PARSE_FAILED,
        context.request_id ?? null,
        { iteration, error: parseError, trace_id: context.trace_id },
        context.trace_id,
      );
    }
  }

  logAliasRewrite(
    call: ReturnType<typeof canonicalizeForRegistry>,
    traceId: string,
    provider: string,
    model: string,
  ): void {
    const logger = this.executor.budgetLogger;
    if (!logger) return;
    const payload: IToolAliasRewrittenPayload = {
      requestedName: call.requestedName,
      canonicalName: call.name,
      renamedParams: [...call.renamedParams],
      droppedParams: [...call.droppedParams],
      entryPoint: ToolCallEntryPoint.REACT_LOOP,
      provider,
      model,
    };
    void logger.info(DomainEventType.ToolAliasRewritten, call.name, { ...payload }, traceId);
  }

  /** Journals a call with its result. A call refused by the cap carries the limit message as its result. */
  async journalAction(
    context: IExecutionContext,
    action: IReActAction,
    toolResultContent: string,
    iteration: number,
  ): Promise<void> {
    await this.executor.logDynamicToolCall?.(
      context.trace_id,
      action.tool,
      action.params,
      toolResultContent.slice(0, REACT_TOOL_RESULT_SUMMARY_MAX),
      iteration,
    );
  }

  /** Wraps an async operation with a heartbeat timer, emitting STREAMING_EVENT_HEARTBEAT
   *  every EXECUTION_HEARTBEAT_INTERVAL_MS while in flight. Timer always cleared in finally. */
  async withHeartbeat<T>(
    context: IExecutionContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    const bus = this.executor.eventBus;
    const stepName = context.plan;
    const loopStart = Date.now();

    let heartbeatId: ReturnType<typeof setInterval> | undefined;
    if (bus) {
      heartbeatId = setInterval(() => {
        const event: IStreamingEvent = {
          eventId: crypto.randomUUID(),
          traceId: context.trace_id,
          timestamp: new Date().toISOString(),
          type: STREAMING_EVENT_HEARTBEAT,
          payload: {
            step: stepName,
            elapsed_ms: Date.now() - loopStart,
          },
        };
        bus.publish(event);
      }, EXECUTION_HEARTBEAT_INTERVAL_MS);
    }

    try {
      return await operation();
    } finally {
      if (heartbeatId !== undefined) {
        clearInterval(heartbeatId);
      }
    }
  }
}
