/**
 * @module DynamicStepExecutor
 * @path src/flows/dynamic_step_executor.ts
 * @description Executes a flow step in dynamic mode: the model receives the step
 * objective and iteratively selects tools from permitted_tools via a ReAct loop
 * until the objective is satisfied or max_iterations is reached.
 * @architectural-layer Flows
 * * @related-files [src/flows/flow_runner.ts, src/shared/schemas/flow.ts]
 */

import type { IFlowStep } from "@exaix/schemas/flow.ts";
import type { IBlueprintFrontmatter } from "@exaix/schemas/blueprint.ts";
import { type McpToolName, StepExecutionMode } from "../shared/enums.ts";
import { READ_ONLY_TOOLS } from "../shared/constants.ts";
import type { JSONValue } from "../shared/types/json.ts";

/**
 * Tool call arguments - JSON-compatible key-value pairs
 */
export type ToolArgs = Record<string, JSONValue>;

/**
 * Journal entry for activity logging
 */
export type JournalEntry = Record<string, JSONValue>;

/**
 * Result from a dynamic step execution
 */
export interface IDynamicStepResult {
  stepId: string;
  output: string;
  toolCallsLog: IDynamicToolCall[];
  iterations: number;
  completed: boolean;
}

/**
 * Log of a single tool call during dynamic execution
 */
export interface IDynamicToolCall {
  tool: McpToolName;
  args: ToolArgs;
  result: string;
  timestamp: string;
}

/**
 * Options for dynamic step execution
 */
export interface IDynamicStepExecutorOptions {
  /** Maximum ReAct iterations before the step is considered complete regardless */
  maxIterations?: number;
  /** Trace ID for Activity Journal correlation */
  traceId: string;
}

const DEFAULT_MAX_ITERATIONS = 10;

/**
 * MCP client interface for tool execution
 */
export interface IMcpClient {
  callTool(tool: McpToolName, args: ToolArgs): Promise<string>;
  getToolDefinitions(tools: McpToolName[]): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, JSONValue>;
  }>;
}

/**
 * LLM client interface for reasoning about next action
 */
export interface ILlmClient {
  reasonNextAction(params: {
    identity: IBlueprintFrontmatter;
    stepObjective: string;
    accumulatedContext: string;
    availableTools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, JSONValue>;
    }>;
    iteration: number;
    maxIterations: number;
  }): Promise<{
    done: boolean;
    tool?: McpToolName;
    args?: ToolArgs;
    output?: string;
  }>;
}

/**
 * Activity journal interface for audit logging
 */
export interface IActivityJournal {
  log(entry: JournalEntry): Promise<void>;
}

/**
 * Executes a single flow step in dynamic (ReAct) mode.
 * The model iteratively selects tools from step.permitted_tools,
 * observes results, and continues until the objective is met.
 *
 * Invariant: only tools in READ_ONLY_TOOLS may appear in permitted_tools.
 * This is enforced at load time by FlowLoader and validated here defensively.
 */
export class DynamicStepExecutor {
  constructor(
    private readonly mcpClient: IMcpClient,
    private readonly llmClient: ILlmClient,
    private readonly activityJournal: IActivityJournal,
  ) {}

  async execute(
    step: IFlowStep,
    identity: IBlueprintFrontmatter,
    input: string,
    opts: IDynamicStepExecutorOptions,
  ): Promise<IDynamicStepResult> {
    if (step.execution_mode !== StepExecutionMode.DYNAMIC) {
      throw new Error(
        `DynamicStepExecutor called on step "${step.id}" which is not in dynamic mode`,
      );
    }

    // Defensive: enforce read-only boundary at runtime even if loader validation passed
    const effectiveTools = this.resolvePermittedTools(step, identity);
    const toolCallsLog: IDynamicToolCall[] = [];

    let context = input;
    let iterations = 0;
    const maxIterations = step.timeout
      ? Math.min(DEFAULT_MAX_ITERATIONS, Math.floor(step.timeout / 1000))
      : DEFAULT_MAX_ITERATIONS;

    while (iterations < maxIterations) {
      iterations++;

      const toolsMetadata = this.mcpClient.getToolDefinitions(effectiveTools);

      // ReAct: model reasons about what tool to call next (or declares done)
      const decision = await this.llmClient.reasonNextAction({
        identity,
        stepObjective: step.name,
        accumulatedContext: context,
        availableTools: toolsMetadata,
        iteration: iterations,
        maxIterations,
      });

      if (decision.done) {
        // Model has declared the step objective is met
        await this.activityJournal.log({
          traceId: opts.traceId,
          stepId: step.id,
          event: "dynamic_step_completed",
          iterations,
          toolCallCount: toolCallsLog.length,
        });
        return {
          stepId: step.id,
          output: decision.output ?? context,
          toolCallsLog,
          iterations,
          completed: true,
        };
      }

      // Validate tool choice against permitted list (runtime guard)
      if (!decision.tool || !effectiveTools.includes(decision.tool)) {
        throw new Error(
          `Dynamic step "${step.id}": model selected tool "${decision.tool}" ` +
            `which is not in permitted_tools. Permitted: [${effectiveTools.join(", ")}]`,
        );
      }

      // Execute the tool call
      const toolResult = await this.mcpClient.callTool(
        decision.tool,
        decision.args ?? {},
      );

      const call: IDynamicToolCall = {
        tool: decision.tool,
        args: decision.args ?? {},
        result: toolResult,
        timestamp: new Date().toISOString(),
      };
      toolCallsLog.push(call);

      // Journal every tool call for auditability (identical to declared mode)
      await this.activityJournal.log({
        traceId: opts.traceId,
        stepId: step.id,
        event: "dynamic_tool_call",
        tool: decision.tool,
        args: decision.args,
        resultSummary: toolResult.substring(0, 200),
        iteration: iterations,
      });

      // Feed observation back into context for next iteration
      context = this.appendObservation(context, decision.tool, toolResult);
    }

    // Max iterations reached — return with what we have
    await this.activityJournal.log({
      traceId: opts.traceId,
      stepId: step.id,
      event: "dynamic_step_max_iterations_reached",
      iterations,
      toolCallCount: toolCallsLog.length,
    });

    return {
      stepId: step.id,
      output: context,
      toolCallsLog,
      iterations,
      completed: false,
    };
  }

  /**
   * Resolves the effective permitted_tools for a step:
   * 1. Start with identity blueprint's permitted_tools
   * 2. Narrow to step's permitted_tools if specified
   * 3. Filter to READ_ONLY_TOOLS only (defensive runtime enforcement)
   */
  private resolvePermittedTools(
    step: IFlowStep,
    identity: IBlueprintFrontmatter,
  ): McpToolName[] {
    const identityTools = new Set(identity.permitted_tools ?? []);

    const stepTools = step.permitted_tools?.length ? step.permitted_tools : [...identityTools];

    return stepTools.filter((tool) => {
      const isAllowed = READ_ONLY_TOOLS.has(tool) && identityTools.has(tool);
      if (!isAllowed) {
        console.warn(
          `Dynamic step "${step.id}": tool "${tool}" filtered out at runtime ` +
            `(must be read-only and in identity permitted_tools)`,
        );
      }
      return isAllowed;
    });
  }

  private appendObservation(
    context: string,
    tool: McpToolName,
    result: string,
  ): string {
    return `${context}\n\n[Tool: ${tool}]\n${result}`;
  }
}
