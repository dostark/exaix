/**
 * @module McpStrategyStderrTest
 * @path tests/agents/mcp_strategy_stderr_test.ts
 * @description Step 61.8 (G5): Verifies stderr stream failures are logged via
 * AgentExecutor.logAgentOutput without aborting McpAgentStrategy stderr piping.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { McpAgentStrategy } from "../../src/services/agent/strategies/mcp_agent_strategy.ts";
import { ProcessManager } from "../../src/services/agent/process_manager.ts";
import type { AgentExecutor } from "../../src/services/agent/agent_executor.ts";
import type { IExecutionContext } from "@exaix/schemas/agent_executor.ts";

function createFailingStderrStream(errorMessage: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let readCount = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (readCount === 0) {
        readCount += 1;
        controller.enqueue(encoder.encode("stderr warning line\n"));
        return;
      }

      controller.error(new Error(errorMessage));
      readCount += 1;
    },
  });
}

Deno.test("McpAgentStrategy: stderr pipe logs stream errors without aborting execution", async () => {
  const outputs: string[] = [];
  const processManager = new ProcessManager();
  const mockExecutor = {
    logAgentOutput: (_traceId: string, output: string) => {
      outputs.push(output);
      return Promise.resolve();
    },
  } as Partial<AgentExecutor>;

  const strategy = new McpAgentStrategy(mockExecutor as AgentExecutor, processManager);
  const context: IExecutionContext = {
    trace_id: "trace-stderr-123",
    request_id: "REQ-STDERR-123",
    request: "Test stderr logging",
    plan: "Step 61.8",
    portal: "main",
  };

  const child = {
    stderr: createFailingStderrStream("boom"),
  } as Deno.ChildProcess;
  const pipeStderrToLogger = Reflect.get(
    strategy,
    "pipeStderrToLogger",
  ) as (child: Deno.ChildProcess, context: IExecutionContext) => Promise<void>;

  try {
    await pipeStderrToLogger.call(strategy, child, context);
  } finally {
    strategy.dispose();
  }

  assertEquals(outputs[0], "stderr warning line");
  assertEquals(outputs.length, 2);
  assertStringIncludes(outputs[1], "stderr pipe error");
  assertStringIncludes(outputs[1], "boom");
});
