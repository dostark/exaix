/**
 * @module ExaCtlMcpCommand
 * @path apps/exactl/src/command_builders/mcp_command.ts
 * @description Builds the exactl mcp command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { ExaCtlOutputFormat, type IExaCtlColumn } from "@exaix/cli";
import { McpCommands } from "../commands/mcp_commands.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb } from "../exactl_constants.ts";
import { actionOutput, cellText, ColumnHeader, type IJsonRow, JSON_INDENT, toRow } from "../output/exactl_output.ts";
import { documentLeaves } from "./documented_children.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";

const SERVER_OPTION = "--server <url:string>";
const SERVER_HELP = "URL of the MCP server";
const DEFAULT_SSE_PORT = 3000;

const TOOL_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: ColumnHeader.NAME, value: (tool) => cellText(tool.name) },
  { header: ColumnHeader.DESCRIPTION, value: (tool) => cellText(tool.description) },
];

function createToolCommand(runtime: IExaCtlRuntime) {
  const { context } = runtime;
  return new Command()
    .description("List and call the tools of an external MCP server")
    .command(
      ExaCtlVerb.LIST,
      new Command()
        .option(SERVER_OPTION, SERVER_HELP, { required: true })
        .action(async (options) => {
          const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
          const { tools = [] } = await new McpCommands(context).connect(options.server, { listTools: true });
          await renderer.list(tools.map(toRow), TOOL_COLUMNS, (tool) => cellText(tool.name));
        }),
    )
    .command(
      `${ExaCtlVerb.CALL} <tool:string>`,
      new Command()
        .option(SERVER_OPTION, SERVER_HELP, { required: true })
        .option("--args <json:string>", "JSON arguments object for the tool call")
        .action(async (options, ...args: string[]) => {
          const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
          const { result } = await new McpCommands(context).connect(options.server, {
            callTool: args[0],
            args: options.args,
          });
          if (result === undefined) return;
          if (renderer.machine) await renderer.item(toRow(result), []);
          else await renderer.text(JSON.stringify(result, null, JSON_INDENT));
        }),
    );
}

function createMcpCommand(runtime: IExaCtlRuntime) {
  const { context } = runtime;
  const noun = nounDocFor(ExaCtlCommandName.MCP);
  const tool = createToolCommand(runtime);
  const command = documentedNoun(new Command(), noun)
    .command(
      ExaCtlVerb.SERVE,
      new Command()
        .option("--sse", "Use SSE/HTTP transport (default: stdio)")
        .option("--port <port:number>", "Port for SSE transport", { default: DEFAULT_SSE_PORT })
        .action(async (options) => {
          const cmd = new McpCommands(context);
          await cmd.start(options);
        }),
    )
    .command(ExaCtlSubNoun.TOOL, tool);
  documentLeaves(command, [ExaCtlCommandName.MCP], noun.lifecycle);
  documentLeaves(tool, [ExaCtlCommandName.MCP, ExaCtlSubNoun.TOOL], noun.lifecycle);
  return command;
}

export function buildMcpCommand(runtime: IExaCtlRuntime): ReturnType<typeof createMcpCommand> {
  return createMcpCommand(runtime);
}
