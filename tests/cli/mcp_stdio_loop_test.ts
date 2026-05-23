// deno-lint-ignore-file no-explicit-any
/**
 * @module MCPStdioLoopTest
 * @path tests/cli/mcp_stdio_loop_test.ts
 * @description Verifies the MCP Stdio execution loop, ensuring robust low-level
 * JSON-RPC transport and correct error reporting for malformed messages.
 */

import { assertEquals } from "@std/assert";
import { type IMcpStdioServer, runMcpStdioLoop } from "../../apps/exactl/src/commands/mcp_commands.ts";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

Deno.test("runMcpStdioLoop: writes JSON responses and ignores blank lines", async () => {
  const outputs: string[] = [];
  const decoder = new TextDecoder();

  const server: IMcpStdioServer = {
    start: () => {},
    handleRequest: (req: any) => Promise.resolve({ ok: true, echo: (req as { id?: number }).id }),
  };

  await runMcpStdioLoop(server, {
    stdin: streamFromText('{"id":1}\n\n{"id":2}\n'),
    writeStdout: (data: Uint8Array) => {
      outputs.push(decoder.decode(data));
      return Promise.resolve(data.length);
    },
  });

  assertEquals(outputs.length, 2);
  assertEquals(outputs[0].trim(), JSON.stringify({ ok: true, echo: 1 }));
  assertEquals(outputs[1].trim(), JSON.stringify({ ok: true, echo: 2 }));
});

Deno.test("runMcpStdioLoop: reports parse errors via onError", async () => {
  const errors: string[] = [];

  const server: IMcpStdioServer = {
    start: () => {},
    handleRequest: (_req: any) => Promise.resolve(null),
  };

  await runMcpStdioLoop(server, {
    stdin: streamFromText("not-json\n"),
    writeStdout: () => Promise.resolve(0),
    onError: (m: string, e: any) => errors.push(`${m} ${String(e)}`),
  });

  assertEquals(errors.length, 1);
  assertEquals(errors[0].includes("Failed to process request:"), true);
});
