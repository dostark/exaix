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
import type { IModelProvider } from "@exaix/ai/types.ts";
import { AgentExecutionErrorType, ExecutionStrategyName, ToolName } from "@exaix/core";
import { GuardrailBlockedError } from "@exaix/core/planning";
import { parse as parseToml } from "@std/toml";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { IStreamingEvent } from "@exaix/schemas/streaming_event.ts";
import { DomainEventType } from "@exaix/core/events";
import {
  CONTEXT_PRIORITY_REFLECTION,
  CONTEXT_PRIORITY_SYSTEM,
  CONTEXT_PRIORITY_TOOL_RESULT,
  DEFAULT_AGENT_MAX_ITERATIONS,
  EXECUTION_HEARTBEAT_INTERVAL_MS,
  LOOP_HISTORY_BUDGET_THRESHOLD,
  REACT_CALLING_TOOL_PREFIX,
  REACT_DEFAULT_MAX_TOKENS,
  REACT_DEFAULT_TEMPERATURE,
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  REACT_THOUGHT_PREFIX,
  REACT_TOOL_ERROR_PREFIX,
  REACT_TOOL_RESULT_BUDGET_RATIO,
  STREAMING_EVENT_HEARTBEAT,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
} from "@exaix/core";
import type { IModelCallOptions } from "@exaix/schemas";
import type { IContextBudgetManagerInput } from "../context/context_budget_manager.ts";
import type { IContextSegment } from "../context/context_segment.ts";
import type { IReActLoopExecutor } from "../react_loop_adapter.ts";

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

/**
 * ReActLoopStrategy implements in-process agentic execution.
 * It uses the LLM to generate actions, executes them via ToolRegistry,
 * and maintains a loop until the task is complete.
 */
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
    let toolCallCount = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCostUsd = 0;

    for (let i = 0; i < this.MAX_ITERATIONS; i++) {
      // 0. Guardrail seam (Phase 107): halt at the iteration boundary if a prior
      //    concurrent screen() accumulated a blocking violation. No-op in Solo (no runner).
      //    The guardrail.block event is already emitted by GuardrailRunner.screen().
      if (
        this.executor.guardrailRunner?.hasBlockingViolation(context.trace_id)
      ) {
        throw new GuardrailBlockedError(
          context.trace_id,
          "Execution halted by a blocking guardrail violation",
        );
      }

      // 1. Apply segment-level budget compaction when manager is configured (Phase 83).
      //    No-op when contextBudgetManager is absent — backward-compatible.
      const budgetedHistory = await this.applyContextBudget(
        blueprint,
        context,
        history,
        i,
      );

      // 2. Build prompt with (possibly compacted) history
      const prompt = this.buildPrompt(
        blueprint,
        context,
        options,
        budgetedHistory,
      );

      // 3. Generate next step with heartbeat during long LLM waits
      const response = await this.withHeartbeat(
        context,
        () =>
          this.provider!.generate(prompt, {
            temperature: REACT_DEFAULT_TEMPERATURE,
            max_tokens: REACT_DEFAULT_MAX_TOKENS,
            ...this.callOptions,
          }),
      );

      // Log individual generation metrics (Phase 69)
      await this.executor.logGeneration(
        context.trace_id,
        options.identity_id ?? "",
        response.model,
        response.provider,
        response.usage,
        response.cost_usd ?? 0,
      );

      // Accumulate metrics for the final result
      totalPromptTokens += response.usage.promptTokens;
      totalCompletionTokens += response.usage.completionTokens;
      totalCostUsd += response.cost_usd ?? 0;

      // 3. Parse thought and actions
      const { thought, actions, isComplete } = this.parseResponse(
        response.content,
      );

      if (thought) {
        history.push({ role: ReActRole.THOUGHT, content: thought });
        await this.executor.logAgentOutput(
          context.trace_id,
          `${REACT_THOUGHT_PREFIX}${thought}`,
        );
      }

      if (isComplete) {
        // Agent signaled completion

        // Screen the final output before review (Phase 107 Step 5).
        // Uses FINAL_ITERATION sentinel — the runner honours screen_final_output config.
        if (response.content) {
          void this.executor.guardrailRunner?.screen(
            response.content,
            context.trace_id,
            Number.MAX_SAFE_INTEGER,
          );
          if (
            this.executor.guardrailRunner?.hasBlockingViolation(
              context.trace_id,
            )
          ) {
            throw new GuardrailBlockedError(
              context.trace_id,
              "Guardrail blocked final output before review",
            );
          }
        }

        const finalResult = this.createFinalResult(
          response.content,
          context,
          startTime,
          toolCallCount,
        );

        // Attach accumulated usage (aggregated across all loop iterations)
        finalResult.usage = {
          prompt_tokens: totalPromptTokens,
          completion_tokens: totalCompletionTokens,
          cost_usd: totalCostUsd,
        };

        return this.executor.validateReviewResult(finalResult);
      }

      if (actions.length === 0) {
        throw new AgentExecutionError(
          "Agent provided no actions and did not signal completion",
          AgentExecutionErrorType.EXECUTION_ERROR,
        );
      }

      // 4. Check tool call limit
      if (toolCallCount + actions.length > (options.max_tool_calls || 100)) {
        throw new AgentExecutionError(
          `Tool call limit exceeded (${options.max_tool_calls})`,
          AgentExecutionErrorType.TOOL_ERROR,
        );
      }

      // Guardrail seam (Phase 107): fire-and-forget screening of the agent output.
      // No-op in Solo (no runner injected); Team edition screens concurrently and
      // surfaces a verdict via hasBlockingViolation.
      if (response.content) {
        void this.executor.guardrailRunner?.screen(
          response.content,
          context.trace_id,
          i,
        );
      }

      // 5. Execute actions
      for (const action of actions) {
        toolCallCount++;
        await this.executor.logAgentOutput(
          context.trace_id,
          `${REACT_CALLING_TOOL_PREFIX}${action.tool}`,
        );

        const result = await this.executeTool(action, options);
        history.push({
          role: ReActRole.RESULT,
          content: `Tool ${action.tool} result: ${JSON.stringify(result)}`,
        });

        if (!result.success) {
          // Let the agent see the error and decide how to proceed
          await this.executor.logAgentOutput(
            context.trace_id,
            `${REACT_TOOL_ERROR_PREFIX}${result.error}`,
          );
        }
      }
    }

    throw new AgentExecutionError(
      `Reached maximum iterations (${this.MAX_ITERATIONS}) without completing task`,
      AgentExecutionErrorType.EXECUTION_ERROR,
    );
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
  ): string {
    const historyText = this.buildBudgetedHistoryText(history);

    return `IDENTITY: ${blueprint.name}
CAPABILITIES: ${blueprint.capabilities.join(", ")}

CONTEXT:
Portal: ${options.portal}
Trace ID: ${context.trace_id}
Request: ${context.request}
Plan Step: ${context.plan}

${history.length > 0 ? `HISTORY:\n${historyText}` : ""}

INSTRUCTIONS:
1. Reason about the current state.
2. If you need more information or need to make changes, output one or more tool calls in TOML format.
3. If the task is finished, output "${REACT_STATUS_COMPLETE}" and provide a summary of changes.
4. Output your thought process preceded by "${REACT_THOUGHT_PREFIX}".

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
${REACT_SUMMARY_PREFIX}[What was done]
`;
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
  ): { thought?: string; actions: IReActAction[]; isComplete: boolean } {
    const isComplete = response.includes(REACT_STATUS_COMPLETE);

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
      } catch { /* ignore parse errors */ }
    }

    return { thought, actions, isComplete };
  }

  private createFinalResult(
    response: string,
    context: IExecutionContext,
    startTime: number,
    toolCallCount: number,
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
}
