/**
 * @module ReActLoopStrategy
 * @path packages/execution/src/strategies/react_loop_strategy.ts
 * @description In-process reasoning strategy using the ReAct (Reasoning + Acting) loop.
 * Executes tasks by prompting an LLM for tool calls and processing results within Exaix.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_orchestrator.ts, packages/execution/src/strategies/execution_strategy.ts]
 */

import type { IExecutionStrategy } from "./execution_strategy.ts";
import { AgentExecutionError, type IAgentFileBlueprint } from "../agent_orchestrator.ts";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
import type { IModelProvider, IProviderTurn, IToolDefinition } from "@exaix/ai/types.ts";
import type { IProviderToolCall } from "@exaix/ai/providers";
import type { IGenerateResult } from "@exaix/ai/providers";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import type { ITool, IToolResult } from "@exaix/core/types";
import { AgentExecutionErrorType, ExecutionStrategyName, ToolName } from "@exaix/core";
import { GuardrailBlockedError } from "@exaix/core/planning";
import { parse as parseToml } from "@std/toml";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { IStreamingEvent } from "@exaix/schemas/streaming_event.ts";
import { DomainEventType } from "@exaix/core/events";
import {
  AGENT_EVENT_RESPONSE_TRUNCATED,
  CONTEXT_PRIORITY_REFLECTION,
  CONTEXT_PRIORITY_SYSTEM,
  CONTEXT_PRIORITY_TOOL_RESULT,
  DEFAULT_AGENT_MAX_ITERATIONS,
  EXECUTION_HEARTBEAT_INTERVAL_MS,
  LOOP_HISTORY_BUDGET_THRESHOLD,
  REACT_CALLING_TOOL_PREFIX,
  REACT_DEFAULT_MAX_TOKENS,
  REACT_DEFAULT_TEMPERATURE,
  REACT_EVENT_ACTION_PARSE_FAILED,
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  REACT_THOUGHT_PREFIX,
  REACT_TOOL_RESULT_BUDGET_RATIO,
  REACT_TOOL_RESULT_SUMMARY_MAX,
  RESPONSE_STOP_REASON_MAX_TOKENS,
  STREAMING_EVENT_HEARTBEAT,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
} from "@exaix/core";
import type { IModelCallOptions } from "@exaix/schemas";
import type { IContextBudgetManagerInput } from "../context/context_budget_manager.ts";
import type { IContextSegment } from "../context/context_segment.ts";
import type { IReActLoopExecutor } from "../react_loop_adapter.ts";
import { computeRegistryPredictedCost } from "../registry_computed_cost.ts";

export interface IReActAction {
  tool: string;
  params: Record<string, JSONValue>;
  description?: string;
}

interface IToolExecutionResult {
  success?: boolean;
  error?: string;
  data?: JSONValue;
}

/**
 * Roles for the internal ReAct loop history.
 */
enum ReActRole {
  THOUGHT = "thought",
  ACTION = "action",
  RESULT = "result",
}

/** Tools that mutate a portal file; their `path` param is a change the audit must authorize. */
const REACT_WRITE_TOOLS: ReadonlySet<string> = new Set<string>([
  ToolName.WRITE_FILE,
  ToolName.PATCH_FILE,
  ToolName.DELETE_FILE,
  ToolName.MOVE_FILE,
  ToolName.CREATE_DIRECTORY,
]);

/**
 * ReActLoopStrategy implements in-process agentic execution.
 * It uses the LLM to generate actions, executes them via ToolRegistry,
 * and maintains a loop until the task is complete.
 */
export /** Internal type for dynamically-built provider.generate() options. */
interface GeneratedOptions {
  temperature: number;
  max_tokens: number;
  tools?: IToolDefinition[];
  toolChoice?: { type: string; disable_parallel_tool_use: boolean };
  priorTurn?: IProviderTurn;
}

/** Parameters for runSingleIteration. */
interface IIterationParams {
  i: number;
  startTime: number;
  blueprint: IAgentFileBlueprint;
  context: IExecutionContext;
  options: IAgentExecutionOptions;
  history: Array<{ role: ReActRole; content: string }>;
  writtenFiles: Set<string>;
  toolCallCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsd: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  nativeToolsUsed: boolean;
  nativeToolDefinitions?: Opt<IToolDefinition[], Reason.OptionalInput>;
  nativeToolsPriorTurn?: Opt<IProviderTurn, Reason.OptionalInput>;
}

/** Result of a single iteration in execute(). */
interface IIterationResult {
  toolCallCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsd: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  nativeToolsPriorTurn?: IProviderTurn;
  done: boolean;
  result?: IChangesetResult;
}

export class ReActLoopStrategy implements IExecutionStrategy {
  public readonly name = ExecutionStrategyName.REACT;
  /** Per-call options (thinking/effort/max_tokens) set by agent_executor before execute(). */
  public callOptions?: IModelCallOptions;
  private readonly MAX_ITERATIONS = DEFAULT_AGENT_MAX_ITERATIONS;

  constructor(
    private executor: IReActLoopExecutor,
    private provider?: Opt<IModelProvider, Reason.OptionalDependency>,
  ) {}

  async execute(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
  ): Promise<IChangesetResult> {
    if (!this.provider) {
      throw new AgentExecutionError(
        "Model provider required for ReAct loop strategy",
        AgentExecutionErrorType.CONFIGURATION_ERROR,
      );
    }

    const startTime = Date.now();
    const history: Array<{ role: ReActRole; content: string }> = [];
    const writtenFiles = new Set<string>();
    let toolCallCount = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCostUsd = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreationTokens = 0;

    // Step 5: native-tools gate — both the opt-in flag AND the provider capability must be true.
    const useNativeTools = options.native_tools_enabled === true &&
      ProviderRegistry.getProviderMetadata(this.provider.id)?.supportsNativeTools === true;
    let nativeToolsPriorTurn: IProviderTurn | undefined;
    let nativeToolDefinitions: IToolDefinition[] | undefined;
    let nativeToolsUsed = false;
    if (useNativeTools) {
      const tools = this.executor.toolRegistry?.getTools() ?? [];
      nativeToolDefinitions = this.buildNativeToolDefinitions(tools);
      nativeToolsUsed = true;
    }

    for (let i = 0; i < this.MAX_ITERATIONS; i++) {
      const iterResult = await this.runSingleIteration({
        i,
        startTime,
        blueprint,
        context,
        options,
        history,
        writtenFiles,
        toolCallCount,
        totalPromptTokens,
        totalCompletionTokens,
        totalCostUsd,
        totalCacheReadTokens,
        totalCacheCreationTokens,
        nativeToolsUsed,
        nativeToolDefinitions,
        nativeToolsPriorTurn,
      });
      toolCallCount = iterResult.toolCallCount;
      totalPromptTokens = iterResult.totalPromptTokens;
      totalCompletionTokens = iterResult.totalCompletionTokens;
      totalCostUsd = iterResult.totalCostUsd;
      totalCacheReadTokens = iterResult.totalCacheReadTokens;
      totalCacheCreationTokens = iterResult.totalCacheCreationTokens;
      nativeToolsPriorTurn = iterResult.nativeToolsPriorTurn;
      if (iterResult.done) {
        return iterResult.result!;
      }
    }

    throw new AgentExecutionError(
      `Reached maximum iterations (${this.MAX_ITERATIONS}) without completing task`,
      AgentExecutionErrorType.EXECUTION_ERROR,
    );
  }

  /** Screen final output, build the changeset result, and attach accumulated usage. */
  private finishLoop(
    content: string,
    context: IExecutionContext,
    startTime: number,
    toolCallCount: number,
    writtenFiles: ReadonlySet<string>,
    usage: {
      promptTokens: number;
      completionTokens: number;
      costUsd: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
    },
  ): IChangesetResult {
    // Screen the final output before review (Phase 107 Step 5).
    // Uses FINAL_ITERATION sentinel — the runner honours screen_final_output config.
    if (content) {
      void this.executor.guardrailRunner?.screen(content, context.trace_id, Number.MAX_SAFE_INTEGER);
      if (this.executor.guardrailRunner?.hasBlockingViolation(context.trace_id)) {
        throw new GuardrailBlockedError(
          context.trace_id,
          "Guardrail blocked final output before review",
        );
      }
    }

    const finalResult = this.createFinalResult(content, context, startTime, toolCallCount, writtenFiles);
    finalResult.usage = {
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      cost_usd: usage.costUsd,
      cache_read_tokens: usage.cacheReadTokens,
      cache_creation_tokens: usage.cacheCreationTokens,
      // ReActLoopStrategy's cost_usd is always a calculateCost() estimate — no direct-API
      // provider ever returns a real reported figure — so this is always "predicted".
      cost_source: "predicted",
    };
    return this.executor.validateReviewResult(finalResult);
  }

  /** Journal each dropped-action TOML parse error so a vanished action is attributable. */
  private journalParseErrors(parseErrors: string[], context: IExecutionContext, iteration: number): void {
    for (const parseError of parseErrors) {
      void this.executor.budgetLogger?.warn(
        REACT_EVENT_ACTION_PARSE_FAILED,
        context.request_id ?? null,
        { iteration, error: parseError, trace_id: context.trace_id },
        context.trace_id,
      );
    }
  }

  /** Record a successful write-type tool's target path as a change the audit must authorize. */
  private recordWrittenFile(
    action: IReActAction,
    result: IToolExecutionResult,
    writtenFiles: Set<string>,
  ): void {
    if (!result.success || !REACT_WRITE_TOOLS.has(action.tool)) return;
    const path = action.params.path;
    if (typeof path === "string" && path.length > 0) writtenFiles.add(path);
  }

  /**
   * Parse a native tool-use response into actions. Returns empty actions and
   * isComplete=true when the model chose not to use any tool.
   */
  private parseNativeToolResponse(response: IGenerateResult): {
    toolCalls: IProviderToolCall[] | undefined;
    actions: IReActAction[];
    isComplete: boolean;
  } {
    const toolCalls = response.toolCalls;
    if (toolCalls && toolCalls.length > 0) {
      const actions = toolCalls.map((tc) => ({
        tool: tc.name,
        params: tc.input as Record<string, JSONValue>,
      }));
      return { toolCalls, actions, isComplete: false };
    }
    return { toolCalls: undefined, actions: [], isComplete: true };
  }

  /**
   * Build the options object for provider.generate() when native tools are active.
   * Includes tools, toolChoice (any + disable_parallel_tool_use), and priorTurn on
   * iterations after the first. Returns base options when native tools are inactive.
   */
  private buildNativeGenerateOptions(
    nativeToolDefinitions?: Opt<IToolDefinition[], Reason.OptionalInput>,
    nativeToolsPriorTurn?: Opt<IProviderTurn, Reason.OptionalInput>,
    nativeToolsUsed = false,
  ): GeneratedOptions {
    const base = Object.assign({
      temperature: REACT_DEFAULT_TEMPERATURE,
      max_tokens: REACT_DEFAULT_MAX_TOKENS,
    }, this.callOptions) as GeneratedOptions;
    if (nativeToolsUsed && nativeToolDefinitions) {
      base.tools = nativeToolDefinitions;
      base.toolChoice = { type: "any", disable_parallel_tool_use: true };
      if (nativeToolsPriorTurn) {
        base.priorTurn = nativeToolsPriorTurn;
      }
    }
    return base;
  }

  /** Log a warning when the response was truncated at max_tokens. */
  private logMaxTokensTruncation(
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
        identity_id: options.identity_id ?? "",
        iteration,
        stop_reason: response.stop_reason,
        response_length: response.content.length,
        completion_tokens: response.usage.completionTokens,
      },
      context.trace_id,
    );
  }

  /**
   * Execute one iteration of the ReAct loop. Returns accumulated metrics and
   * optionally a finished result when the loop should terminate early.
   */
  private async runSingleIteration(
    params: IIterationParams,
  ): Promise<IIterationResult> {
    const {
      i,
      startTime,
      blueprint,
      context,
      options,
      history,
      writtenFiles,
      toolCallCount,
      totalPromptTokens,
      totalCompletionTokens,
      totalCostUsd,
      totalCacheReadTokens,
      totalCacheCreationTokens,
      nativeToolsUsed,
      nativeToolDefinitions,
      nativeToolsPriorTurn,
    } = params;
    if (this.executor.guardrailRunner?.hasBlockingViolation(context.trace_id)) {
      throw new GuardrailBlockedError(
        context.trace_id,
        "Execution halted by a blocking guardrail violation",
      );
    }

    const budgetedHistory = await this.applyContextBudget(blueprint, context, history, i);
    const prompt = this.buildPrompt(blueprint, context, options, budgetedHistory, nativeToolsUsed);

    const generateOptions = this.buildNativeGenerateOptions(
      nativeToolDefinitions,
      nativeToolsPriorTurn,
      nativeToolsUsed,
    );
    const generateStartTime = Date.now();
    const response = await this.withHeartbeat(context, () => this.provider!.generate(prompt, generateOptions as never));
    const generateDurationMs = Date.now() - generateStartTime;

    this.logMaxTokensTruncation(response, options, i, context);

    const registryCostUsd = computeRegistryPredictedCost(response.provider, response.model, {
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      cacheReadTokens: response.usage.cacheReadTokens,
      cacheCreationTokens: response.usage.cacheCreationTokens,
    });
    const costUsd = registryCostUsd ?? response.cost_usd ?? 0;

    await this.executor.logGeneration(
      context.trace_id,
      options.identity_id ?? "",
      response.model,
      response.provider,
      { ...response.usage, costUsd, durationMs: generateDurationMs },
    );

    const iterPromptTokens = response.usage.promptTokens;
    const iterCompletionTokens = response.usage.completionTokens;
    const iterCostUsd = costUsd;
    const iterCacheReadTokens = response.usage.cacheReadTokens ?? 0;
    const iterCacheCreationTokens = response.usage.cacheCreationTokens ?? 0;

    const newTotalPromptTokens = totalPromptTokens + iterPromptTokens;
    const newTotalCompletionTokens = totalCompletionTokens + iterCompletionTokens;
    const newTotalCostUsd = totalCostUsd + iterCostUsd;
    const newTotalCacheReadTokens = totalCacheReadTokens + iterCacheReadTokens;
    const newTotalCacheCreationTokens = totalCacheCreationTokens + iterCacheCreationTokens;

    const parsed = this.parseIterationResponse(response, nativeToolsUsed);

    if (!nativeToolsUsed) {
      this.journalParseErrors(parsed.parseErrors, context, i);
    }

    if (parsed.thought) {
      history.push({ role: ReActRole.THOUGHT, content: parsed.thought });
      await this.executor.logAgentOutput(context.trace_id, `${REACT_THOUGHT_PREFIX} ${parsed.thought}`);
    }

    if (parsed.isComplete && parsed.actions.length === 0) {
      const result = this.finishLoop(
        response.content,
        context,
        startTime,
        toolCallCount,
        writtenFiles,
        {
          promptTokens: newTotalPromptTokens,
          completionTokens: newTotalCompletionTokens,
          costUsd: newTotalCostUsd,
          cacheReadTokens: newTotalCacheReadTokens,
          cacheCreationTokens: newTotalCacheCreationTokens,
        },
      );
      return {
        toolCallCount,
        totalPromptTokens: newTotalPromptTokens,
        totalCompletionTokens: newTotalCompletionTokens,
        totalCostUsd: newTotalCostUsd,
        totalCacheReadTokens: newTotalCacheReadTokens,
        totalCacheCreationTokens: newTotalCacheCreationTokens,
        done: true,
        result,
      };
    }

    if (parsed.actions.length === 0) {
      throw new AgentExecutionError(
        "No actions generated in ReAct iteration",
        AgentExecutionErrorType.EXECUTION_ERROR,
      );
    }

    const maxToolCalls = options.max_tool_calls ?? 100;
    if (toolCallCount + parsed.actions.length > maxToolCalls) {
      throw new AgentExecutionError(
        `Exceeded maximum tool calls (${maxToolCalls})`,
        AgentExecutionErrorType.EXECUTION_ERROR,
      );
    }

    if (response.content) {
      void this.executor.guardrailRunner?.screen(response.content, context.trace_id, i);
    }

    let newToolCallCount = toolCallCount;
    let lastPriorTurn = nativeToolsPriorTurn;
    for (let a = 0; a < parsed.actions.length; a++) {
      const action = parsed.actions[a];
      const execResult = await this.executeTool(action, options);
      this.recordWrittenFile(action, execResult, writtenFiles);

      const toolResultContent = execResult.success
        ? JSON.stringify(execResult.data ?? {})
        : (execResult.error ?? "Unknown error");
      newToolCallCount++;

      const toolCallLine = `${REACT_CALLING_TOOL_PREFIX}${action.tool}(${JSON.stringify(action.params)})`;
      history.push({ role: ReActRole.ACTION, content: toolCallLine });

      const resultEntry = `Tool ${action.tool} result: ${toolResultContent}`;
      const truncatedResult = resultEntry.length > REACT_TOOL_RESULT_SUMMARY_MAX
        ? resultEntry.slice(0, REACT_TOOL_RESULT_SUMMARY_MAX) + "..."
        : resultEntry;
      history.push({ role: ReActRole.RESULT, content: truncatedResult });

      await this.executor.logDynamicToolCall?.(
        context.trace_id,
        action.tool,
        action.params,
        toolResultContent.slice(0, REACT_TOOL_RESULT_SUMMARY_MAX),
        i,
      );

      if (nativeToolsUsed && parsed.nativeToolCalls?.[a]) {
        lastPriorTurn = this.buildPriorTurn(
          parsed.nativeToolCalls[a],
          execResult as never,
        );
      }
    }

    if (parsed.isComplete) {
      const result = this.finishLoop(
        response.content,
        context,
        startTime,
        newToolCallCount,
        writtenFiles,
        {
          promptTokens: newTotalPromptTokens,
          completionTokens: newTotalCompletionTokens,
          costUsd: newTotalCostUsd,
          cacheReadTokens: newTotalCacheReadTokens,
          cacheCreationTokens: newTotalCacheCreationTokens,
        },
      );
      return {
        toolCallCount: newToolCallCount,
        totalPromptTokens: newTotalPromptTokens,
        totalCompletionTokens: newTotalCompletionTokens,
        totalCostUsd: newTotalCostUsd,
        totalCacheReadTokens: newTotalCacheReadTokens,
        totalCacheCreationTokens: newTotalCacheCreationTokens,
        nativeToolsPriorTurn: lastPriorTurn,
        done: true,
        result,
      };
    }

    return {
      toolCallCount: newToolCallCount,
      totalPromptTokens: newTotalPromptTokens,
      totalCompletionTokens: newTotalCompletionTokens,
      totalCostUsd: newTotalCostUsd,
      totalCacheReadTokens: newTotalCacheReadTokens,
      totalCacheCreationTokens: newTotalCacheCreationTokens,
      nativeToolsPriorTurn: lastPriorTurn,
      done: false,
    };
  }

  /**
   * Parse the provider response into thought, actions, and completion state.
   * Dispatches to either the native-tools branch or the TOML-block branch.
   */
  private parseIterationResponse(
    response: IGenerateResult,
    nativeToolsUsed: boolean,
  ): {
    thought?: string;
    actions: IReActAction[];
    isComplete: boolean;
    parseErrors: string[];
    nativeToolCalls?: IProviderToolCall[];
  } {
    if (nativeToolsUsed) {
      const nativeResult = this.parseNativeToolResponse(response);
      return {
        actions: nativeResult.actions,
        isComplete: nativeResult.isComplete,
        parseErrors: [],
        nativeToolCalls: nativeResult.toolCalls,
      };
    }
    const parsed = this.parseResponse(response.content);
    return {
      thought: parsed.thought,
      actions: parsed.actions,
      isComplete: parsed.isComplete,
      parseErrors: parsed.parseErrors,
    };
  }

  private async executeTool(
    action: IReActAction,
    options: IAgentExecutionOptions,
  ): Promise<IToolExecutionResult> {
    if (!this.executor.toolRegistry) {
      throw new AgentExecutionError(
        "ToolRegistry not available",
        AgentExecutionErrorType.CONFIGURATION_ERROR,
      );
    }

    // Ensure portal isolation via path prefixing (consistent with McpAgentStrategy)
    const enrichedParams = { ...action.params };
    if (
      options.portal && enrichedParams.path &&
      typeof enrichedParams.path === "string" &&
      !enrichedParams.path.startsWith("@")
    ) {
      enrichedParams.path = `@${options.portal}/${enrichedParams.path}`;
    }

    return await this.executor.toolRegistry.execute(
      action.tool,
      enrichedParams,
    ) as IToolExecutionResult;
  }

  /**
   * Wraps an async operation with a heartbeat timer.
   * Emits STREAMING_EVENT_HEARTBEAT every EXECUTION_HEARTBEAT_INTERVAL_MS
   * while the operation is in flight. Timer is always cleared in finally.
   */
  private async withHeartbeat<T>(
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

  /**
   * Applies IContextBudgetManager to the current iteration's history.
   * Returns filtered history when the manager is configured, or the
   * original history unchanged when it is absent (backward-compatible).
   */
  private async applyContextBudget(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    history: Array<{ role: ReActRole; content: string }>,
    iteration: number,
  ): Promise<Array<{ role: ReActRole; content: string }>> {
    const budgetManager = this.executor.contextBudgetManager;
    const promptBudget = this.executor.currentPromptBudget;
    if (!budgetManager || !promptBudget) return history;

    const segments: IContextSegment[] = [];

    // Per-segment cap for tool_result kind in dynamic mode (GAP-5).
    const toolResultCap = Math.floor(
      promptBudget.sections.loopHistory * REACT_TOOL_RESULT_BUDGET_RATIO,
    );

    // System prompt — always protected
    if (blueprint.systemPrompt) {
      segments.push({
        segmentId: `system-${context.trace_id}`,
        kind: "system",
        content: blueprint.systemPrompt,
        priority: CONTEXT_PRIORITY_SYSTEM,
        tokenEstimate: Math.ceil(
          blueprint.systemPrompt.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN,
        ),
        metadata: {},
      });
    }

    // History entries: results → tool_result, thoughts/actions → reflection
    for (let idx = 0; idx < history.length; idx++) {
      const entry = history[idx];
      const kind = entry.role === ReActRole.RESULT ? "tool_result" as const : "reflection" as const;
      let tokenEstimate = Math.ceil(
        entry.content.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN,
      );
      if (kind === "tool_result" && toolResultCap > 0) {
        tokenEstimate = Math.min(tokenEstimate, toolResultCap);
      }
      segments.push({
        segmentId: `hist-${idx}-${context.trace_id}`,
        kind,
        content: entry.content,
        priority: kind === "tool_result" ? CONTEXT_PRIORITY_TOOL_RESULT : CONTEXT_PRIORITY_REFLECTION,
        tokenEstimate,
        metadata: { iterationIndex: iteration },
      });
    }

    const input: IContextBudgetManagerInput = {
      traceId: context.trace_id,
      stepId: `react-iter-${iteration}`,
      model: blueprint.model,
      promptBudget,
      segments,
      provider: this.provider,
    };

    const { snapshot } = await budgetManager.prepare(input);

    // Emit budget pressure journal event if utilisation exceeds the threshold
    if (
      snapshot.maxContextTokens > 0 &&
      snapshot.usedInputTokens / snapshot.maxContextTokens >=
        LOOP_HISTORY_BUDGET_THRESHOLD
    ) {
      void this.executor.budgetLogger?.info(
        DomainEventType.ContextBudgetExceeded,
        context.trace_id,
        {
          model: blueprint.model as string,
          contextWindow: snapshot.maxContextTokens as number,
          estimatedTokens: snapshot.usedInputTokens as number,
          tokenSource: "heuristic" as string,
        },
      );
    }

    // Rebuild history from kept history segments (system segment is not in history)
    const keptHistoryIds = new Set(
      snapshot.decisions
        .filter((d) => d.action === "keep" || d.action === "trim")
        .map((d) => d.segmentId)
        .filter((id) => id.startsWith("hist-")),
    );

    return history.filter((_, idx) => keptHistoryIds.has(`hist-${idx}-${context.trace_id}`));
  }

  private buildPrompt(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
    history: Array<{ role: ReActRole; content: string }>,
    skipToolProse = false,
  ): string {
    const historyText = this.buildBudgetedHistoryText(history);

    let prompt = `IDENTITY: ${blueprint.name}
CAPABILITIES: ${blueprint.capabilities.join(", ")}

CONTEXT:
Portal: ${options.portal}
Trace ID: ${context.trace_id}
Request: ${context.request}
Plan Step: ${context.plan}

${history.length > 0 ? `HISTORY:\n${historyText}` : ""}

INSTRUCTIONS:
1. Reason about the current state.
2. If you need more information or need to make changes, output one or more tool calls.
3. If the task is finished, output "${REACT_STATUS_COMPLETE}" and provide a summary of changes.
4. Output your thought process preceded by "${REACT_THOUGHT_PREFIX}".`;

    if (!skipToolProse) {
      prompt += `

AVAILABLE TOOLS:
${
        (options.permitted_tools ||
          [
            ToolName.READ_FILE,
            ToolName.WRITE_FILE,
            ToolName.RUN_COMMAND,
            ToolName.LIST_DIRECTORY,
            ToolName.SEARCH_FILES,
          ])
          .join(", ")
      }

FORMAT:
${REACT_THOUGHT_PREFIX}[Your reasoning]
\`\`\`toml
[[actions]]
tool = "[tool_name]"
[actions.params]
[param_name] = [value]
\`\`\`

OR

${REACT_STATUS_COMPLETE}
${REACT_SUMMARY_PREFIX}[What was done]`;
    }

    return prompt;
  }

  private buildBudgetedHistoryText(
    history: Array<{ role: ReActRole; content: string }>,
  ): string {
    const historyEntries = history.map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`);
    const maxChars = this.getLoopHistoryCharBudget();

    if (!maxChars) {
      return historyEntries.join("\n\n");
    }

    let remainingEntries = [...historyEntries];
    let historyText = remainingEntries.join("\n\n");

    while (remainingEntries.length > 1 && historyText.length > maxChars) {
      remainingEntries = remainingEntries.slice(1);
      historyText = remainingEntries.join("\n\n");
    }

    if (historyText.length <= maxChars) {
      return historyText;
    }

    return historyText.slice(Math.max(0, historyText.length - maxChars));
  }

  private getLoopHistoryCharBudget(): number | undefined {
    const promptBudget = this.executor.currentPromptBudget;
    const loopHistoryTokens = promptBudget?.sections?.loopHistory;

    if (!loopHistoryTokens || loopHistoryTokens <= 0) {
      return undefined;
    }

    return loopHistoryTokens * TOKEN_ESTIMATION_CHARS_PER_TOKEN;
  }

  private parseResponse(
    response: string,
  ): { thought?: string; actions: IReActAction[]; isComplete: boolean; parseErrors: string[] } {
    const isComplete = response.includes(REACT_STATUS_COMPLETE);
    const parseErrors: string[] = [];

    // Capture the text after the THOUGHT: prefix up to the first action block, the
    // completion marker, or end of response. No literal spaces inside the lookahead
    // alternatives: the previous pattern required a space-padded " ```toml " / " $",
    // which never matches fence-on-its-own-line responses — so thought was always
    // undefined and the model's reasoning never entered the loop history.
    const thoughtPattern = `${REACT_THOUGHT_PREFIX}\\s*(.*?)(?=\`\`\`toml|${REACT_STATUS_COMPLETE}|$)`;
    const thoughtMatch = response.match(new RegExp(thoughtPattern, "s"));
    const thought = thoughtMatch ? thoughtMatch[1].trim() : undefined;

    const actions: IReActAction[] = [];
    const codeBlockRegex = /```toml\s*([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(response)) !== null) {
      try {
        const block = match[1].trim();
        const parsed = parseToml(block) as {
          actions?: Array<
            {
              tool: string;
              params?: Record<string, JSONValue>;
              description?: string;
            }
          >;
        };

        if (parsed.actions && Array.isArray(parsed.actions)) {
          for (const act of parsed.actions) {
            if (act.tool) {
              actions.push({
                tool: act.tool,
                params: act.params || {},
                description: act.description,
              });
            }
          }
        }
      } catch (error) {
        // A malformed action block must not vanish silently — a dropped action is how a
        // fix disappears while the loop reports success. Collect the error for the caller
        // to journal.
        parseErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    return { thought, actions, isComplete, parseErrors };
  }

  private createFinalResult(
    response: string,
    context: IExecutionContext,
    startTime: number,
    toolCallCount: number,
    writtenFiles: ReadonlySet<string>,
  ): IChangesetResult {
    // Try to extract JSON from the response using the executor's parser (Phase 61.2)
    // This allows the agent to provide a summary JSON at the end of the ReAct loop
    const jsonResult = this.executor.parseAgentResponse(
      response,
      context,
      startTime,
    );

    // Always merge tool call count from the loop with any manual count in JSON
    jsonResult.tool_calls = (jsonResult.tool_calls || 0) + toolCallCount;

    // Report the files the loop actually wrote (union with any the parser found), so
    // the git audit can authorize the step's own changes rather than reverting them.
    jsonResult.files_changed = [...new Set([...(jsonResult.files_changed ?? []), ...writtenFiles])];

    // If we have a summary text but no explicit JSON description, use the summary
    const summaryMatch = response.match(
      new RegExp(`${REACT_SUMMARY_PREFIX}\\s*(.*)`, "s"),
    );
    if (
      summaryMatch &&
      (!jsonResult.description || jsonResult.description === context.plan)
    ) {
      jsonResult.description = summaryMatch[1].trim();
    }

    return jsonResult;
  }

  /**
   * Map ToolRegistry's ITool[] to provider-agnostic IToolDefinition[].
   * Pure transformation — no I/O, no side effects.
   */
  private buildNativeToolDefinitions(tools: ITool[]): IToolDefinition[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters as never,
    }));
  }

  /**
   * Build an IProviderTurn from a completed tool call and its result.
   * Pure transformation — no I/O, no side effects.
   */
  private buildPriorTurn(toolCall: IProviderToolCall, result: IToolResult): IProviderTurn {
    return {
      toolUseId: toolCall.id,
      toolName: toolCall.name,
      toolInput: toolCall.input,
      toolResultContent: JSON.stringify(result.data ?? result.error ?? {}),
      toolResultIsError: !result.success,
    };
  }
}
