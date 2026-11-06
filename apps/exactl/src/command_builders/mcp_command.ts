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
import { ExaCtlSubNoun, ExaCtlVerb } from "../exactl_constants.ts";

function createToolCommand(runtime: IExaCtlRuntime) {
  const { context } = runtime;
  return new Command()
    .description("List and call the tools of an external MCP server")
    .command(
      ExaCtlVerb.LIST,
      new Command()
        .description("List the tools of an external MCP server")
        .option("--server <url:string>", "URL of the MCP server", { required: true })
        .action(async (options) => {
          await new McpCommands(context).connect(options.server, { listTools: true });
        }),
    )
    .command(
      `${ExaCtlVerb.CALL} <tool:string>`,
      new Command()
        .description("Call one tool of an external MCP server")
        .option("--server <url:string>", "URL of the MCP server", { required: true })
        .option("--args <json:string>", "JSON arguments object for the tool call")
        .action(async (options, ...args: string[]) => {
          await new McpCommands(context).connect(options.server, { callTool: args[0], args: options.args });
        }),
    );
}

function createMcpCommand(runtime: IExaCtlRuntime) {
  const { context } = runtime;
  return new Command()
    .description("Model Context Protocol server and client")
    .command(
      ExaCtlVerb.SERVE,
      new Command()
        .description("Start MCP server (stdio transport)")
        .option("--sse", "Use SSE/HTTP transport (default: stdio)")
        .option("--port <port:number>", "Port for SSE transport", { default: 3000 })
        .action(async (options) => {
          const cmd = new McpCommands(context);
          await cmd.start(options);
        }),
    )
    .command(ExaCtlSubNoun.TOOL, createToolCommand(runtime));
}

export function buildMcpCommand(runtime: IExaCtlRuntime): ReturnType<typeof createMcpCommand> {
  return createMcpCommand(runtime);
}
