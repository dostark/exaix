/**
 * @module MockAgent
 * @path tests/integration/agent/mock_agent.ts
 * @description Mock agent for testing MCP-based agent execution.
 */
import { TextLineStream } from "@std/streams";
import { ToolName } from "../../../src/shared/enums.ts";

async function main() {
  console.error("DEBUG: Mock agent started");
  // 1. Handshake
  console.log(JSON.stringify({ type: "ready", pid: Deno.pid }));

  // 2. Wait for task
  const lineStream = Deno.stdin.readable
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream());

  const reader = lineStream.getReader();
  const { value, done } = await reader.read();

  if (done) {
    console.error("DEBUG: stdin closed immediately");
    Deno.exit(1);
  }

  const taskMsg = JSON.parse(value);
  console.error("DEBUG: Received task: " + JSON.stringify(taskMsg));
  const { context } = taskMsg;

  // 3. Perform tool calls based on request
  const filesChanged: string[] = [];
  if (context.request === "write_authorized") {
    console.error("DEBUG: Sending call_tool for authorized.txt");
    // Call write_file for an authorized path
    console.log(JSON.stringify({
      type: "call_tool",
      id: "t1",
      tool: ToolName.WRITE_FILE,
      params: {
        portal: context.portal,
        path: "authorized.txt",
        content: "this is authorized",
        identity_id: "test-agent",
      },
    }));
    await reader.read();
    filesChanged.push("authorized.txt");
  } else if (context.request === "write_unauthorized") {
    console.error("DEBUG: Sending call_tool for unauthorized.txt");
    // Call write_file for an unauthorized path
    console.log(JSON.stringify({
      type: "call_tool",
      id: "t2",
      tool: ToolName.WRITE_FILE,
      params: {
        portal: context.portal,
        path: "unauthorized.txt",
        content: "this is unauthorized",
        identity_id: "test-agent",
      },
    }));
    await reader.read();
    filesChanged.push("unauthorized.txt");
  }

  // 4. Return result
  console.error("DEBUG: Sending final result");
  console.log(JSON.stringify({
    type: "result",
    result: {
      branch: "feat/test",
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: filesChanged,
      description: "Done",
      tool_calls: 1,
      execution_time_ms: 100,
    },
  }));

  Deno.exit(0);
}

main();
