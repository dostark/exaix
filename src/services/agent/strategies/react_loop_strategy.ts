/**
 * @module ReActLoopStrategy
 * @path src/services/agent/strategies/react_loop_strategy.ts
 * @description In-process reasoning strategy using the ReAct (Reasoning + Acting) loop.
 * Executes tasks by prompting an LLM for tool calls and processing results within Exaix.
 * @architectural-layer Services
 * @related-files [src/services/agent/agent_executor.ts, src/services/plan/plan_executor.ts]
 */

import type { IExecutionStrategy } from "./execution_strategy.ts";
import { AgentExecutionError, type AgentExecutor, type IAgentFileBlueprint } from "../agent_executor.ts";
import type {
  IAgentExecutionOptions,
  IChangesetResult,
  IExecutionContext,
} from "../../../shared/schemas/agent_executor.ts";
import type { IModelProvider } from "../../../ai/types.ts";
import { AgentExecutionErrorType, ExecutionStrategyName, ToolName } from "../../../shared/enums.ts";
import { parse as parseToml } from "@std/toml";
import type { JSONValue } from "../../../shared/types/json.ts";
import type { IEventBusService } from "../../observability/event_bus_service.ts";
import type { IStreamingEvent } from "../../../shared/schemas/streaming_event.ts";
import {
  DEFAULT_AGENT_MAX_ITERATIONS,
  EXECUTION_HEARTBEAT_INTERVAL_MS,
  REACT_CALLING_TOOL_PREFIX,
  REACT_DEFAULT_MAX_TOKENS,
  REACT_DEFAULT_TEMPERATURE,
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  REACT_THOUGHT_PREFIX,
  REACT_TOOL_ERROR_PREFIX,
  STREAMING_EVENT_HEARTBEAT,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
} from "../../../shared/constants.ts";

interface IReActLoopExecutor {
  logAgentOutput: AgentExecutor["logAgentOutput"];
  validateReviewResult: AgentExecutor["validateReviewResult"];
  parseAgentResponse: AgentExecutor["parseAgentResponse"];
  toolRegistry: AgentExecutor["toolRegistry"];
  logGeneration: AgentExecutor["logGeneration"];
  eventBus?: IEventBusService;
}

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
  private readonly MAX_ITERATIONS = DEFAULT_AGENT_MAX_ITERATIONS;

  constructor(
    private executor: IReActLoopExecutor,
    private provider?: IModelProvider,
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
      // 1. Build prompt with history
      const prompt = this.buildPrompt(blueprint, context, options, history);

      // 2. Generate next step with heartbeat during long LLM waits
      const response = await this.withHeartbeat(context, () =>
        this.provider!.generate(prompt, {
          temperature: REACT_DEFAULT_TEMPERATURE,
          max_tokens: REACT_DEFAULT_MAX_TOKENS,
        }));

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
      const { thought, actions, isComplete } = this.parseResponse(response.content);

      if (thought) {
        history.push({ role: ReActRole.THOUGHT, content: thought });
        await this.executor.logAgentOutput(context.trace_id, `${REACT_THOUGHT_PREFIX}${thought}`);
      }

      if (isComplete) {
        // Agent signaled completion
        const finalResult = this.createFinalResult(response.content, context, startTime, toolCallCount);

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

      // 5. Execute actions
      for (const action of actions) {
        toolCallCount++;
        await this.executor.logAgentOutput(context.trace_id, `${REACT_CALLING_TOOL_PREFIX}${action.tool}`);

        const result = await this.executeTool(action, options);
        history.push({
          role: ReActRole.RESULT,
          content: `Tool ${action.tool} result: ${JSON.stringify(result)}`,
        });

        if (!result.success) {
          // Let the agent see the error and decide how to proceed
          await this.executor.logAgentOutput(context.trace_id, `${REACT_TOOL_ERROR_PREFIX}${result.error}`);
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
      throw new AgentExecutionError("ToolRegistry not available", AgentExecutionErrorType.CONFIGURATION_ERROR);
    }

    // Ensure portal isolation via path prefixing (consistent with McpAgentStrategy)
    const enrichedParams = { ...action.params };
    if (
      options.portal && enrichedParams.path && typeof enrichedParams.path === "string" &&
      !enrichedParams.path.startsWith("@")
    ) {
      enrichedParams.path = `@${options.portal}/${enrichedParams.path}`;
    }

    return await this.executor.toolRegistry.execute(action.tool, enrichedParams) as IToolExecutionResult;
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

    let heartbeatId: number | undefined;
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
        [ToolName.READ_FILE, ToolName.WRITE_FILE, ToolName.RUN_COMMAND, ToolName.LIST_DIRECTORY, ToolName.SEARCH_FILES])
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
    const promptBudget = Reflect.get(this.executor, "currentPromptBudget") as {
      sections?: { loopHistory?: number };
    } | undefined;
    const loopHistoryTokens = promptBudget?.sections?.loopHistory;

    if (!loopHistoryTokens || loopHistoryTokens <= 0) {
      return undefined;
    }

    return loopHistoryTokens * TOKEN_ESTIMATION_CHARS_PER_TOKEN;
  }

  private parseResponse(response: string): { thought?: string; actions: IReActAction[]; isComplete: boolean } {
    const isComplete = response.includes(REACT_STATUS_COMPLETE);

    // Improved thought parsing to handle both prefix and blocks
    const thoughtPattern = `${REACT_THOUGHT_PREFIX}\\s*(.*?)(?= \`\`\`toml | ${REACT_STATUS_COMPLETE} | $)`;
    const thoughtMatch = response.match(new RegExp(thoughtPattern, "s"));
    const thought = thoughtMatch ? thoughtMatch[1].trim() : undefined;

    const actions: IReActAction[] = [];
    const codeBlockRegex = /```toml\s*([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(response)) !== null) {
      try {
        const block = match[1].trim();
        const parsed = parseToml(block) as {
          actions?: Array<{ tool: string; params?: Record<string, JSONValue>; description?: string }>;
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
    const jsonResult = this.executor.parseAgentResponse(response, context, startTime);

    // Always merge tool call count from the loop with any manual count in JSON
    jsonResult.tool_calls = (jsonResult.tool_calls || 0) + toolCallCount;

    // If we have a summary text but no explicit JSON description, use the summary
    const summaryMatch = response.match(new RegExp(`${REACT_SUMMARY_PREFIX}\\s*(.*)`, "s"));
    if (summaryMatch && (!jsonResult.description || jsonResult.description === context.plan)) {
      jsonResult.description = summaryMatch[1].trim();
    }

    return jsonResult;
  }
}
