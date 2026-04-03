/**
 * @module McpAgentStrategy
 * @path src/services/agent/strategies/mcp_agent_strategy.ts
 * @description Implementation of the MCP-based agent execution strategy (Out-of-Process).
 * @architectural-layer Services
 * @related-files [src/services/agent/agent_executor.ts, src/services/agent/process_manager.ts, src/services/agent/agent_entrypoint.ts]
 */

import { IExecutionStrategy } from "./execution_strategy.ts";
import { AgentExecutionError, AgentExecutor, IAgentFileBlueprint } from "../agent_executor.ts";
import { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "../../../shared/schemas/agent_executor.ts";
import { SafeSubprocess } from "../../../helpers/subprocess.ts";
import { ProcessManager } from "../process_manager.ts";
import { TextLineStream } from "@std/streams";
import { AgentExecutionErrorType, SecurityMode } from "../../../shared/enums.ts";

/**
 * MCP execution strategy that spawns a separate Deno process
 */
export class McpAgentStrategy implements IExecutionStrategy {
  public readonly name = "mcp";
  private readonly HANDSHAKE_TIMEOUT_MS = 30000;

  constructor(
    private executor: AgentExecutor,
    private processManager: ProcessManager,
  ) {}

  async execute(
    blueprint: IAgentFileBlueprint,
    context: IExecutionContext,
    options: IAgentExecutionOptions,
  ): Promise<IChangesetResult> {
    // Build agent arguments
    const args = this.buildAgentArgs(blueprint, options);

    // Spawn subprocess
    const child = SafeSubprocess.spawn("deno", args, {
      env: {
        EXA_AGENT_MODE: "true",
        EXA_TRACE_ID: context.trace_id,
      },
    });

    const pid = child.pid;
    this.processManager.track(pid);

    // Create a single line stream for stdout
    const lineStream = child.stdout
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream());

    const reader = lineStream.getReader();

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
      // Capture stderr on error (non-blocking)
      try {
        const stderr = await this.readStderr(child);
        if (stderr) {
          console.error(`[McpAgentStrategy] Agent stderr: ${stderr}`);
        }
      } catch (_e) { /* ignore */ }

      this.processManager.untrack(pid);
      try {
        Deno.kill(pid, "SIGKILL");
      } catch { /* ignore */ }

      throw error;
    } finally {
      reader.releaseLock();
      this.processManager.untrack(pid);
      // Ensure all streams are closed to prevent leaks
      try {
        await child.stdout.cancel();
      } catch { /* ignore */ }
      try {
        await child.stderr.cancel();
      } catch { /* ignore */ }
    }
  }

  private buildAgentArgs(_blueprint: IAgentFileBlueprint, options: IAgentExecutionOptions): string[] {
    const args = ["run"];

    // Permissions based on SecurityMode
    if (options.security_mode === SecurityMode.SANDBOXED) {
      args.push("--allow-read", "--allow-net");
    } else {
      args.push("--allow-all");
    }

    // Path to entry point
    args.push("src/services/agent/agent_entrypoint.ts");

    // Agent command flags
    args.push("--handshake");

    return args;
  }

  private async waitForReady(reader: ReadableStreamDefaultReader<string>): Promise<void> {
    let timeoutId: number | undefined;

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

  private handleQuery(tool: string, _params: any, context: IExecutionContext): Promise<any> {
    if (tool === "parent_context_query") {
      // Provide a simplified view of the parent context/memory
      return Promise.resolve({
        trace_id: context.trace_id,
        current_step: context.request,
        portal: context.portal,
        // In a real implementation, this would query the DB for recent activities or memory banks
        recent_activities: [],
        memory_banks: [
          { name: "main", path: "@memory/main.md" },
        ],
      });
    }

    throw new Error(`Execution of unknown query tool: ${tool}`);
  }

  private async readStderr(child: Deno.ChildProcess): Promise<string> {
    const reader = child.stderr.getReader();
    try {
      const { value, done } = await reader.read();
      if (done) return "";
      return new TextDecoder().decode(value);
    } finally {
      reader.releaseLock();
    }
  }
}
