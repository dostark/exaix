/**
 * @module McpAgentStrategy
 * @path packages/execution/src/strategies/mcp_agent_strategy.ts
 * @description Implementation of the MCP-based agent execution strategy (Out-of-Process).
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_composer.ts, packages/execution/src/strategies/execution_strategy.ts]
 */

import type { IExecutionStrategy } from "./execution_strategy.ts";
import { type AgentComposer, AgentExecutionError, type IAgentFileBlueprint } from "../agent_composer.ts";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import { SafeSubprocess } from "@exaix/core";
import { ProcessManager } from "@exaix/core";
import { TextLineStream } from "@std/streams";
import {
  AgentExecutionErrorType,
  DEFAULT_AGENT_HANDSHAKE_TIMEOUT_MS,
  ENV_AGENT_MODE,
  ENV_PORTAL_ALIAS,
  ENV_TRACE_ID,
  ExecutionStrategyName,
  SystemCommand,
} from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import type { IToolResult } from "@exaix/core/types";

/**
 * MCP execution strategy that spawns a separate Deno process
 */
export class McpAgentStrategy implements IExecutionStrategy {
  public readonly name = ExecutionStrategyName.MCP;
  private readonly HANDSHAKE_TIMEOUT_MS = DEFAULT_AGENT_HANDSHAKE_TIMEOUT_MS;

  constructor(
    private executor: AgentComposer,
    private processManager: ProcessManager = new ProcessManager(),
  ) {}

  async execute(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
  ): Promise<IChangesetResult> {
    // Build agent arguments
    const args = this.buildAgentArgs(blueprint, options);

    // Spawn subprocess
    const child = SafeSubprocess.spawn(SystemCommand.DENO, args, {
      env: {
        [ENV_AGENT_MODE]: "true",
        [ENV_TRACE_ID]: context.trace_id,
        [ENV_PORTAL_ALIAS]: options.portal,
      },
    });
    const pid = child.pid;
    this.processManager.track(pid);

    // Create a single line stream for stdout
    const lineStream = child.stdout
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream());

    const reader = lineStream.getReader();

    // Start stderr piping concurrently (resolved via Promise.race below)
    const stderrDone = this.pipeStderrToLogger(child, context);

    try {
      // 1. Handshake
      await this.waitForReady(reader);

      // 2. Send Task
      const encoder = new TextEncoder();
      const writer = child.stdin.getWriter();
      await writer.write(encoder.encode(JSON.stringify({ context, options }) + "\n"));

      // 3. Receive Messages/Result (Multiplexed loop)
      let finalResult: IChangesetResult | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        try {
          const message = JSON.parse(value);
          if (message.type === "result") {
            finalResult = message.result;
            break;
          } else if (message.type === "query") {
            const queryResponse = await this.handleQuery(message.tool, message.params, context);
            await writer.write(encoder.encode(
              JSON.stringify({
                type: "query_response",
                id: message.id,
                result: queryResponse,
              }) + "\n",
            ));
          } else if (message.type === "call_tool") {
            const toolResult = await this.handleToolCall(message.tool, message.params);
            await writer.write(encoder.encode(
              JSON.stringify({
                type: "tool_response",
                id: message.id,
                result: toolResult,
              }) + "\n",
            ));
          }
        } catch (error) {
          console.error(
            `[McpAgentStrategy] Parse/Execution error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      await writer.close();

      if (!finalResult) {
        throw new AgentExecutionError(
          "Agent process ended without returning a result",
          AgentExecutionErrorType.EXECUTION_ERROR,
        );
      }

      // 4. Capture exit code
      const status = await child.status;
      if (!status.success) {
        throw new AgentExecutionError(
          `Agent process exited with code ${status.code}`,
          AgentExecutionErrorType.EXECUTION_ERROR,
        );
      }

      return this.executor.validateReviewResult(finalResult);
    } catch (error) {
      this.processManager.untrack(pid);
      try {
        Deno.kill(pid, "SIGKILL");
      } catch { /* ignore */ }

      throw error;
    } finally {
      reader.releaseLock();
      this.processManager.untrack(pid);
      // Cancel stderr stream to unblock the piping promise, then wait for it to clean up
      try {
        await child.stderr.cancel();
      } catch { /* ignore */ }
      let stderrTimerId: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          stderrDone,
          new Promise((resolve) => {
            stderrTimerId = setTimeout(resolve, 1000);
          }),
        ]);
      } catch { /* ignore stderr errors */ }
      if (stderrTimerId) clearTimeout(stderrTimerId);
    }
  }

  private buildAgentArgs(_blueprint: IAgentFileBlueprint, _options: IAgentExecutionOptions): string[] {
    const args = ["run"];

    // Both SANDBOXED and HYBRID modes spawn the MCP agent with the same scoped grant
    // (--allow-read --allow-net), never --allow-all — this call site has no portal path
    // to express a narrower --allow-read=<portal> scope.
    args.push("--allow-read", "--allow-net");

    // Path to entry point
    const entrypoint = Deno.env.get("EXAIX_AGENT_ENTRYPOINT") || "apps/agent-entrypoint/main.ts";
    args.push(entrypoint);

    // Agent command flags
    args.push("--handshake");

    return args;
  }

  private buildParentContextQueryResult(context: IExecutionContext): Record<string, JSONValue> {
    return {
      trace_id: context.trace_id,
      current_step: context.request,
      portal: context.portal,
      recent_activities: [],
      memory_banks: [
        { name: "main", path: "@memory/main.md" },
      ],
    };
  }

  private async waitForReady(reader: ReadableStreamDefaultReader<string>): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const handshakePromise = (async () => {
      const { value, done } = await reader.read();
      if (done) throw new Error("Agent process closed before handshake");
      return value;
    })();

    try {
      const value = await Promise.race([
        handshakePromise,
        new Promise<string>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("Handshake timeout")), this.HANDSHAKE_TIMEOUT_MS);
        }),
      ]);

      const message = JSON.parse(value);
      if (message.type !== "ready") {
        throw new Error(`Unexpected agent message during handshake: ${value}`);
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private async handleQuery(
    tool: string,
    _params: Record<string, JSONValue>,
    context: IExecutionContext,
  ): Promise<Record<string, JSONValue>> {
    if (tool === "parent_context_query") {
      // Query real recent activities from the Activity Journal
      const recentActivities = await this.executor.getRecentActivitiesByTraceId(context.trace_id);
      const result = this.buildParentContextQueryResult(context);
      result.recent_activities = recentActivities;
      return result;
    }

    throw new Error(`Execution of unknown query tool: ${tool}`);
  }

  private async handleToolCall(toolName: string, params: Record<string, JSONValue>): Promise<IToolResult> {
    if (!this.executor.toolRegistry) {
      throw new Error("ToolRegistry not available in AgentComposer");
    }

    // If tool specifies 'portal' and 'path', translate to '@Portal/path' for legacy registry tools,
    // since MCP agents use (portal, path) while ToolRegistry expects alias paths.
    const enrichedParams = { ...params };
    if (params.portal && params.path && typeof params.path === "string" && !params.path.startsWith("@")) {
      enrichedParams.path = `@${params.portal}/${params.path}`;
    }

    const toolResult = await this.executor.toolRegistry.execute(toolName, enrichedParams);
    return toolResult;
  }

  private async pipeStderrToLogger(child: Deno.ChildProcess, context: IExecutionContext): Promise<void> {
    const reader = child.stderr
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream())
      .getReader();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value.trim()) {
          await this.executor.logAgentOutput(context.trace_id, value);
        }
      }
    } catch (error) {
      await this.executor.logAgentOutput(
        context.trace_id,
        `[stderr pipe error: ${error instanceof Error ? error.message : String(error)}]`,
      );
    } finally {
      reader.releaseLock();
    }
  }

  /** Call this when the strategy is no longer needed. */
  dispose(): void {
    this.processManager.dispose();
  }
}
