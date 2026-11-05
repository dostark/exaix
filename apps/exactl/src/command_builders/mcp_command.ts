/**
 * @module ExaCtlMcpCommand
 * @path apps/exactl/src/command_builders/mcp_command.ts
 * @description Builds the exactl mcp command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { McpCommands } from "../commands/mcp_commands.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";

function createMcpCommand(runtime: IExaCtlRuntime) {
  const { context } = runtime;
  return new Command()
    .description("Model Context Protocol server")
    .command(
      "start",
      new Command()
        .description("Start MCP server (stdio transport)")
        .option("--sse", "Use SSE/HTTP transport (default: stdio)")
        .option("--port <port:number>", "Port for SSE transport", { default: 3000 })
        .action(async (options) => {
          const cmd = new McpCommands(context);
          await cmd.start(options);
        }),
    )
    .command(
      "connect",
      new Command()
        .description("Connect outbound to a real external MCP server")
        .arguments("<url:string>")
        .option("--list-tools", "List the server's available tools")
        .option("--call-tool <name:string>", "Call a tool by name")
        .option("--args <json:string>", "JSON arguments object for --call-tool")
        .action(async (options, url: string) => {
          const cmd = new McpCommands(context);
          await cmd.connect(url, options);
        }),
    );
}

export function buildMcpCommand(runtime: IExaCtlRuntime): ReturnType<typeof createMcpCommand> {
  return createMcpCommand(runtime);
}
