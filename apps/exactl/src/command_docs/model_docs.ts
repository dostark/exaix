/**
 * @module ModelCommandDocs
 * @path apps/exactl/src/command_docs/model_docs.ts
 * @description The doc records of the exactl model noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_builders/model_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import { exactlCommand } from "./doc_helpers.ts";

const MODEL = ExaCtlCommandName.MODEL;

export const MODEL_NOUN_DOC: IExaCtlNounDoc = {
  noun: MODEL,
  group: ExaCtlCommandGroup.OPERATIONS,
  summary: "Inspect the model registry and choose the models",
  description:
    "The registry lists which service serves which model and at what price. You select the provider, curate the candidate list per size and check how routing ranks the roles.",
  lifecycle: [],
};

export const MODEL_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [MODEL, ExaCtlVerb.LIST],
    summary: "List the registry models",
    description:
      "Lists one row per service that serves a model, with its provenance, the verified date and the price per million tokens. Narrow it with `--model <author>/<model>`.",
    examples: [
      { title: "List the models", command: "exactl model list" },
      { title: "List one model as JSON", command: "exactl model list --model openai/gpt-4o-mini -o json" },
    ],
    seeAlso: [
      exactlCommand(...[MODEL, ExaCtlVerb.USE]),
      exactlCommand(...[MODEL, ExaCtlVerb.CANDIDATES]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [MODEL, ExaCtlVerb.REFRESH],
    summary: "Refresh the Team model catalog",
    description:
      "Tells you how the Team daemon refreshes the catalog. It needs the Team live registry and does nothing in Solo.",
    examples: [
      { title: "Refresh the catalog", command: "exactl model refresh" },
    ],
    seeAlso: [
      exactlCommand(...[MODEL, ExaCtlVerb.LIST]),
      exactlCommand(...[MODEL, ExaCtlVerb.CANDIDATES]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [MODEL, ExaCtlVerb.USE],
    summary: "Set the provider and its default model",
    description: "Sets the provider, and the default model when you give `<provider>:<model>`.",
    examples: [
      { title: "Use a provider", command: "exactl model use anthropic:claude-sonnet-5-5" },
    ],
    seeAlso: [
      exactlCommand(...[MODEL, ExaCtlVerb.LIST]),
      exactlCommand(...[MODEL, ExaCtlVerb.CANDIDATES]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [MODEL, ExaCtlVerb.CANDIDATES],
    summary: "Curate the model candidate lists",
    description:
      "Writes the candidate list of a size, or a characteristic sub-list, and `--clear` empties it. `--list` shows every curated list.",
    examples: [
      { title: "Show the lists", command: "exactl model candidates --list" },
      { title: "Set a list", command: "exactl model candidates --size M anthropic ollama" },
    ],
    seeAlso: [
      exactlCommand(...[MODEL, ExaCtlVerb.LIST]),
      exactlCommand(...[MODEL, ExaCtlVerb.USE]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [MODEL, ExaCtlSubNoun.ROUTE, ExaCtlVerb.EXPLAIN],
    summary: "Explain the routing of a request",
    description:
      "Shows which agent role the routing policy selects for the request file and the ranked candidates. It runs nothing.",
    examples: [
      { title: "Explain a request", command: "exactl model route explain --request Workspace/Requests/request-1.md" },
    ],
    seeAlso: [
      exactlCommand(...[MODEL, ExaCtlSubNoun.ROUTE, ExaCtlVerb.VALIDATE]),
      exactlCommand(...[MODEL, ExaCtlVerb.LIST]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [MODEL, ExaCtlSubNoun.ROUTE, ExaCtlVerb.VALIDATE],
    summary: "Validate a routing policy file",
    description: "Checks a routing policy YAML file. It exits with a failure when the file is invalid.",
    examples: [
      { title: "Validate a policy", command: "exactl model route validate policies/routing.yaml" },
    ],
    seeAlso: [
      exactlCommand(...[MODEL, ExaCtlSubNoun.ROUTE, ExaCtlVerb.EXPLAIN]),
      exactlCommand(...[MODEL, ExaCtlVerb.LIST]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND, ExaCtlExitCode.INVALID],
    output: ExaCtlOutputKind.ITEM,
  },
];
