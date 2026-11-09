/**
 * @module McpCommands
 * @path apps/exactl/src/commands/mcp_commands.ts
 * @description Provides CLI commands for the MCP verb: starting the inbound
 * MCP server (delegates to the standalone exaix-team/apps/mcp-server/main.ts
 * entry point) and connecting outbound to a real external MCP server via
 * `ExternalMcpClient`.
 * @architectural-layer CLI
 * @related-files ["exaix-team/apps/mcp-server/main.ts", "exaix-team/packages/mcp-server/server.ts", "packages/mcp/src/external_mcp_client.ts"]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import {
  ExternalMcpClient,
  type IExternalMcpCallResult,
  type IExternalMcpClient,
  type IExternalMcpToolDefinition,
} from "@exaix/mcp";
import type { Opt, Reason } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";
import { EXA_MCP_BEARER_TOKEN_ENV_VAR, STDIO_INHERIT } from "./constants.ts";

/** What `connect` returns: the tools of a list request, or the result of a call request. */
export interface IMcpConnectResult {
  tools?: IExternalMcpToolDefinition[];
  result?: IExternalMcpCallResult;
}

export class McpCommands extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  protected async runDenoCommand(args: string[]): Promise<void> {
    const cmd = new Deno.Command("deno", {
      args,
      stdin: STDIO_INHERIT,
      stdout: STDIO_INHERIT,
      stderr: STDIO_INHERIT,
    });

    const child = cmd.spawn();
    const status = await child.status;

    if (!status.success) {
      throw new Error(`MCP server exited with code ${status.code}`);
    }
  }

  /** Lists or calls a tool on an MCP server and always closes the connection, even when the action throws. */
  async connect(
    endpoint: string,
    options: { listTools?: boolean; callTool?: string; args?: string },
  ): Promise<IMcpConnectResult> {
    const url = this.parseEndpointUrl(endpoint);
    const callArgs = options.callTool ? this.parseCallToolArgs(options.args) : undefined;
    const client = this.createExternalMcpClient();
    const bearerToken = Deno.env.get(EXA_MCP_BEARER_TOKEN_ENV_VAR);
    try {
      await client.connect(url, bearerToken ? { bearerToken } : undefined);
      if (options.callTool) {
        return { result: await client.callTool(options.callTool, callArgs ?? {}) };
      }
      if (options.listTools) {
        return { tools: await client.listTools() };
      }
      return {};
    } finally {
      await client.close();
    }
  }

  /** Test seam: substituted in tests to spy on close()/connect() without a real socket. */
  protected createExternalMcpClient(): IExternalMcpClient {
    return new ExternalMcpClient();
  }

  private parseEndpointUrl(endpoint: string): URL {
    try {
      return new URL(endpoint);
    } catch {
      throw new Error(`Invalid <url> argument: '${endpoint}' is not a valid URL.`);
    }
  }

  private parseCallToolArgs(args: Opt<string, Reason.OptionalInput>): Record<string, JSONValue> {
    if (!args) return {};
    try {
      return JSON.parse(args) as Record<string, JSONValue>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid --args JSON: ${message}`);
    }
  }

  async start(options: { sse?: boolean; port?: number }): Promise<void> {
    const args = ["run", "--allow-all", "exaix-team/apps/mcp-server/main.ts"];

    if (options.sse) {
      args.push("--transport", "sse");
      if (options.port) {
        args.push("--port", String(options.port));
      }
    } else {
      args.push("--transport", "stdio");
    }

    await this.runDenoCommand(args);
  }
}
