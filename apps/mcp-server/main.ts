/**
 * @module McpServerApp
 * @path apps/mcp-server/main.ts
 * @description Standalone MCP server entry point. Wires minimal services and starts
 * the MCP server over stdio or SSE transport.
 * @architectural-layer Application
 * @related-files ["packages-team/mcp-server/server.ts", "apps/exactl/src/commands/mcp_commands.ts"]
 */

import { ConfigService } from "@exaix/core/config";
import { DatabaseService } from "@exaix/storage-sqlite";
import type { IDatabaseService } from "@exaix/core/types";
import type { ICliApplicationContext } from "@exaix/core/types";
import type { IModelProvider } from "@exaix/ai";
import type { IGitService } from "@exaix/core/types";
import type { IDisplayService } from "@exaix/core/types";
import { MCPServer } from "@exaix-team/mcp-server";
import { DEFAULT_MCP_HTTP_PORT, McpTransportType } from "@exaix/mcp";
import { validateMCPToolResponse, validateToolResultEnvelope } from "@exaix/schemas/tool_result_validator.ts";
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

function createProviderStub(): IModelProvider {
  return {
    id: "mcp-server",
    generate: () =>
      Promise.resolve({
        content: "",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "stub",
        provider: "mcp-server",
      }),
  };
}

function createGitServiceStub(): IGitService {
  return {
    setRepository: () => {},
    getRepository: () => "",
    ensureRepository: () => Promise.resolve(),
    ensureIdentity: () => Promise.resolve(),
    createBranch: () => Promise.resolve(""),
    commit: () => Promise.resolve(""),
    checkoutBranch: () => Promise.resolve(),
    getCurrentBranch: () => Promise.resolve("main"),
    getDefaultBranch: () => Promise.resolve("main"),
    addWorktree: () => Promise.resolve(),
    removeWorktree: () => Promise.resolve(),
    pruneWorktrees: () => Promise.resolve(""),
    listWorktrees: () => Promise.resolve([]),
    runGitCommand: () => Promise.resolve({ output: "", exitCode: 0 }),
  };
}

function createDisplayServiceStub(): IDisplayService {
  return {
    info: async () => {},
    warn: async () => {},
    error: async () => {},
    debug: async () => {},
    fatal: async () => {},
  };
}

function parseFlags(): { transport: McpTransportType; port: number } {
  const transportIndex = Deno.args.indexOf("--transport");
  const transportValue = transportIndex >= 0 && transportIndex + 1 < Deno.args.length
    ? Deno.args[transportIndex + 1]
    : "stdio";

  const portIndex = Deno.args.indexOf("--port");
  const port = portIndex >= 0 && portIndex + 1 < Deno.args.length
    ? parseInt(Deno.args[portIndex + 1], 10)
    : DEFAULT_MCP_HTTP_PORT;

  return {
    transport: transportValue === "sse" ? McpTransportType.SSE : McpTransportType.STDIO,
    port,
  };
}

if (import.meta.main) {
  const { transport, port } = parseFlags();

  const configPath = Deno.env.get("EXA_CONFIG_PATH");
  const configService = new ConfigService(configPath);
  const config = configService.get();

  const dbService: IDatabaseService = new DatabaseService(config);

  const context: ICliApplicationContext = {
    config: configService,
    db: dbService,
    provider: createProviderStub(),
    git: createGitServiceStub(),
    display: createDisplayServiceStub(),
  };

  const server = new MCPServer({
    context,
    transport,
    resultValidator: {
      validateEnvelope: validateToolResultEnvelope,
      validateMCPResponse: validateMCPToolResponse,
    },
  });

  if (transport === McpTransportType.SSE) {
    await server.startHTTPServer(port);
  } else {
    await runMcpStdioLoop(server, {
      stdin: Deno.stdin.readable,
      writeStdout: (data) => Deno.stdout.write(data),
    });
  }
}
