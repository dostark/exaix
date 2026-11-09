/**
 * @module FlowCommandDocs
 * @path apps/exactl/src/command_docs/flow_docs.ts
 * @description The doc records of the exactl flow noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_builders/flow_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { ExaCtlCommandName, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import { exactlCommand } from "./doc_helpers.ts";

const FLOW = ExaCtlCommandName.FLOW;

export const FLOW_NOUN_DOC: IExaCtlNounDoc = {
  noun: FLOW,
  group: ExaCtlCommandGroup.DEFINITIONS,
  summary: "Define and run multi-agent flows",
  description:
    "A flow is a file that wires several agent roles into steps with dependencies. You run a flow by creating a request for it.",
  lifecycle: [],
};

export const FLOW_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [FLOW, ExaCtlVerb.LIST],
    summary: "List the available flows",
    description:
      "Lists every flow of the workspace with its version, its step count and whether this edition can run it.",
    examples: [
      { title: "List flows", command: "exactl flow list" },
      { title: "List flows as JSON", command: "exactl flow list -o json" },
    ],
    seeAlso: [exactlCommand(FLOW, ExaCtlVerb.SHOW), exactlCommand(FLOW, ExaCtlVerb.RUN)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [FLOW, ExaCtlVerb.SHOW],
    summary: "Show the details of one flow",
    description: "Prints the flow header, its dependency graph, its steps and its settings.",
    examples: [{ title: "Show a flow", command: "exactl flow show code-review" }],
    seeAlso: [exactlCommand(FLOW, ExaCtlVerb.VALIDATE), exactlCommand(FLOW, ExaCtlVerb.BINDINGS)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [FLOW, ExaCtlVerb.RUN],
    summary: "Create a request that runs a flow",
    description:
      "Writes a request file for the flow and its task text. It takes the same options as `exactl request create`, except `--agent`.",
    examples: [{ title: "Run a flow", command: 'exactl flow run code-review "Review the auth module"' }],
    seeAlso: [exactlCommand(FLOW, ExaCtlVerb.SHOW), exactlCommand(ExaCtlCommandName.REQUEST, ExaCtlVerb.WATCH)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [FLOW, ExaCtlVerb.VALIDATE],
    summary: "Validate a flow definition",
    description: "Checks the flow file against the flow schema. It exits with a failure when the flow is invalid.",
    examples: [{ title: "Validate a flow", command: "exactl flow validate code-review" }],
    seeAlso: [exactlCommand(FLOW, ExaCtlVerb.SHOW), exactlCommand(FLOW, ExaCtlVerb.BINDINGS)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [FLOW, ExaCtlVerb.BINDINGS],
    summary: "Resolve the model bindings of every step",
    description:
      "Resolves the service, model, transport and interface of each LLM step across every layer, without calling a provider. It exits with a failure when a step has an issue.",
    examples: [
      { title: "Show the bindings of a flow", command: "exactl flow bindings code-review" },
      { title: "Resolve with a per-run overlay", command: "exactl flow bindings code-review --overlay overlay.toml" },
    ],
    seeAlso: [exactlCommand(FLOW, ExaCtlVerb.VALIDATE), exactlCommand(FLOW, ExaCtlVerb.RUN)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.ITEM,
  },
];
