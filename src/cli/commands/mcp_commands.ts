/**
 * @module McpCommands
 * @path src/cli/commands/mcp_commands.ts
 * @description Provides CLI commands for starting and managing the Model Context Protocol (MCP) server, supporting both stdio and SSE transports.
 * @architectural-layer CLI
 * * @related-files [src/mcp/server.ts, src/cli/main.ts]
 */

import { BaseCommand, type ICommandContext } from "../base.ts";
import { MCPServer } from "../../mcp/server.ts";
import { McpTransportType } from "../../shared/enums.ts";
import { DEFAULT_MCP_HTTP_PORT } from "../../shared/constants.ts";
import type { JSONValue } from "@exaix/core";

interface JSONRPCRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params: Record<string, JSONValue>;
}

export interface IMcpStdioServer {
  start(): void;
  handleRequest(request: JSONRPCRequest): Promise<unknown>;
}

export interface McpStdioIo {
  stdin: ReadableStream<Uint8Array>;
  writeStdout: (data: Uint8Array) => Promise<number> | number;
  onError?: (message: string, error: Error | string | unknown) => void;
}

/**
 * Run the MCP JSON-RPC stdio loop.
 * Extracted for testability; `McpCommands.start()` wires this to Deno stdio.
 */
export async function runMcpStdioLoop(server: IMcpStdioServer, io: McpStdioIo): Promise<void> {
  server.start();

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  for await (const chunk of io.stdin) {
    const text = decoder.decode(chunk);
    const lines = text.split("\n").filter((line) => line.trim() !== "");

    for (const line of lines) {
      try {
        const request = JSON.parse(line) as JSONRPCRequest;
        const response = await server.handleRequest(request);
        if (response) {
          const responseStr = JSON.stringify(response) + "\n";
          await io.writeStdout(encoder.encode(responseStr));
        }
      } catch (error) {
        if (io.onError) {
          io.onError("Failed to process request:", error);
        } else {
          console.error("Failed to process request:", error);
        }
      }
    }
  }
}

export class McpCommands extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  async start(options: { sse?: boolean; port?: number }): Promise<void> {
    const transport = options.sse ? McpTransportType.SSE : McpTransportType.STDIO;
    const server = new MCPServer({
      context: this.context,
      transport,
    });

    if (transport === McpTransportType.SSE) {
      await server.startHTTPServer(options.port || DEFAULT_MCP_HTTP_PORT);
    } else {
      await runMcpStdioLoop(server, {
        stdin: Deno.stdin.readable,
        writeStdout: (data) => Deno.stdout.write(data),
      });
    }
  }
}
