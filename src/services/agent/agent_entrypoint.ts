/**
 * @module AgentEntryPoint
 * @path src/services/agent/agent_entrypoint.ts
 * @description Entry point for spawned agent subprocesses.
 * @architectural-layer Services
 * @related-files [src/services/agent/strategies/mcp_agent_strategy.ts]
 */

import { TextLineStream } from "@std/streams";

async function main() {
  // 1. Handshake
  console.log(JSON.stringify({ type: "ready", pid: Deno.pid }));

  // 2. Wait for context/options
  const lineStream = Deno.stdin.readable
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream());

  const reader = lineStream.getReader();
  const { value, done } = await reader.read();

  if (done) {
    console.error("Parent closed stdin unexpectedly");
    Deno.exit(1);
  }

  const { context, options: _options } = JSON.parse(value);

  // 3. Simulated ReAct loop or Task execution
  // Let's simulate a parent context query if requested in the task
  if (context.request.includes("query_parent")) {
    console.log(JSON.stringify({
      type: "query",
      id: "q1",
      tool: "parent_context_query",
      params: { query: "recent_activities" },
    }));

    // Wait for response to query
    const responseLine = await reader.read();
    if (!responseLine.done) {
      const response = JSON.parse(responseLine.value);
      if (response.type === "query_response" && response.id === "q1") {
        // Continue with result
        console.log(JSON.stringify({
          type: "result",
          result: {
            branch: "feat/mcp-query",
            commit_sha: "0000000000000000000000000000000000000000",
            files_changed: [],
            description: `Query result: ${JSON.stringify(response.result)}`,
            tool_calls: 1,
            execution_time_ms: 100,
          },
        }));
        Deno.exit(0);
      }
    }
  }

  // Default success result
  console.log(JSON.stringify({
    type: "result",
    result: {
      branch: "feat/mcp-test",
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: ["test.ts"],
      description: "Simulated MCP success",
      tool_calls: 0,
      execution_time_ms: 50,
    },
  }));

  Deno.exit(0);
}

if (import.meta.main) {
  main();
}
