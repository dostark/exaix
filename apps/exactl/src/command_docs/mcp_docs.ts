/**
 * @module McpCommandDocs
 * @path apps/exactl/src/command_docs/mcp_docs.ts
 * @description The doc records of the exactl mcp noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_builders/mcp_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import { exactlCommand } from "./doc_helpers.ts";

const MCP = ExaCtlCommandName.MCP;
const TOOL = ExaCtlSubNoun.TOOL;

export const MCP_NOUN_DOC: IExaCtlNounDoc = {
  noun: MCP,
  group: ExaCtlCommandGroup.OPERATIONS,
  summary: "Run the MCP server and call external MCP servers",
  description:
    "Exaix serves its tools over the Model Context Protocol, and it can list and call the tools of another MCP server. The server of another party sends data that you did not write, so treat what it returns as untrusted.",
  lifecycle: [],
};

export const MCP_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [MCP, ExaCtlVerb.SERVE],
    summary: "Start the MCP server",
    description:
      "Starts the Exaix MCP server on stdio. `--sse` serves it over HTTP on `--port` instead. The command runs until you stop it and prints no data of its own.",
    examples: [
      { title: "Serve on stdio", command: "exactl mcp serve" },
      { title: "Serve over HTTP", command: "exactl mcp serve --sse --port 3000" },
    ],
    seeAlso: [exactlCommand(MCP, TOOL, ExaCtlVerb.LIST), exactlCommand(MCP, TOOL, ExaCtlVerb.CALL)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.PROTOCOL,
  },
  {
    path: [MCP, TOOL, ExaCtlVerb.LIST],
    summary: "List the tools of an external MCP server",
    description: "Connects to the server and lists the name and description of each tool.",
    examples: [
      { title: "List the tools", command: "exactl mcp tool list --server http://127.0.0.1:3000/mcp" },
      { title: "List them as JSON", command: "exactl mcp tool list --server http://127.0.0.1:3000/mcp -o json" },
    ],
    seeAlso: [exactlCommand(MCP, TOOL, ExaCtlVerb.CALL), exactlCommand(MCP, ExaCtlVerb.SERVE)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [MCP, TOOL, ExaCtlVerb.CALL],
    summary: "Call one tool of an external MCP server",
    description:
      "Connects to the server, calls the tool with the JSON object of `--args` and prints the result. Set `EXA_MCP_BEARER_TOKEN` for a server that needs a token.",
    examples: [{
      title: "Call a tool",
      command: `exactl mcp tool call echo --server http://127.0.0.1:3000/mcp --args '{"text":"hello"}'`,
    }],
    seeAlso: [exactlCommand(MCP, TOOL, ExaCtlVerb.LIST), exactlCommand(MCP, ExaCtlVerb.SERVE)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE],
    output: ExaCtlOutputKind.ITEM,
  },
];
