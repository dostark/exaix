/**
 * @module PortalCommandDocs
 * @path apps/exactl/src/command_docs/portal_docs.ts
 * @description The doc records of the exactl portal noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_builders/portal_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import { exactlCommand } from "./doc_helpers.ts";

const PORTAL = ExaCtlCommandName.PORTAL;
const KNOWLEDGE = ExaCtlSubNoun.KNOWLEDGE;

export const PORTAL_NOUN_DOC: IExaCtlNounDoc = {
  noun: PORTAL,
  group: ExaCtlCommandGroup.DEFINITIONS,
  summary: "Manage external project portals",
  description:
    "A portal links an external project into the workspace under an alias. Each portal has a context card that describes the project to the agents.",
  lifecycle: [],
};

export const PORTAL_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [PORTAL, ExaCtlVerb.ADD],
    summary: "Add a portal to an external project",
    description: "Links the project at the target path under the alias and writes its context card.",
    examples: [
      { title: "Add a portal", command: "exactl portal add ~/projects/api api" },
      {
        title: "Add a portal with a base branch",
        command: "exactl portal add ~/projects/api api --default-branch develop",
      },
    ],
    seeAlso: [exactlCommand(PORTAL, ExaCtlVerb.LIST), exactlCommand(PORTAL, ExaCtlVerb.VERIFY)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [PORTAL, ExaCtlVerb.LIST],
    summary: "List the configured portals",
    description:
      "Lists every portal with its link, its status and its context card. Add the first one with `exactl portal add <path> <alias>`.",
    examples: [
      { title: "List portals", command: "exactl portal list" },
      { title: "List portals as JSON", command: "exactl portal list -o json" },
    ],
    seeAlso: [exactlCommand(PORTAL, ExaCtlVerb.SHOW), exactlCommand(PORTAL, ExaCtlVerb.ADD)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [PORTAL, ExaCtlVerb.SHOW],
    summary: "Show the details of one portal",
    description: "Prints the target, the link, the status, the context card and the execution settings.",
    examples: [{ title: "Show a portal", command: "exactl portal show api" }],
    seeAlso: [exactlCommand(PORTAL, ExaCtlVerb.VERIFY), exactlCommand(PORTAL, ExaCtlVerb.REFRESH)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [PORTAL, ExaCtlVerb.REMOVE],
    summary: "Remove a portal",
    description:
      "Removes the link and archives the context card. `--keep-card` keeps the card in place. Asks for confirmation first. Pass `--yes` to confirm without a prompt, as scripts must.",
    examples: [{ title: "Remove a portal", command: "exactl portal remove api" }, {
      title: "Remove without a prompt",
      command: "exactl portal remove api --yes",
    }],
    seeAlso: [exactlCommand(PORTAL, ExaCtlVerb.LIST), exactlCommand(PORTAL, ExaCtlVerb.ADD)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND, ExaCtlExitCode.USAGE, ExaCtlExitCode.CANCELLED],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [PORTAL, ExaCtlVerb.VERIFY],
    summary: "Verify the integrity of portals",
    description: "Checks one portal, or every portal without an alias, and lists the issues it finds.",
    examples: [
      { title: "Verify every portal", command: "exactl portal verify" },
      { title: "Verify one portal", command: "exactl portal verify api" },
    ],
    seeAlso: [exactlCommand(PORTAL, ExaCtlVerb.SHOW), exactlCommand(PORTAL, ExaCtlVerb.REFRESH)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [PORTAL, ExaCtlVerb.REFRESH],
    summary: "Refresh the context card of a portal",
    description: "Scans the project again and rewrites its context card.",
    examples: [{ title: "Refresh a portal", command: "exactl portal refresh api" }],
    seeAlso: [exactlCommand(PORTAL, ExaCtlVerb.SHOW), exactlCommand(PORTAL, KNOWLEDGE, ExaCtlVerb.ANALYZE)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [PORTAL, KNOWLEDGE, ExaCtlVerb.ANALYZE],
    summary: "Analyze the codebase of a portal",
    description:
      "Gathers the codebase knowledge of the portal. Pick a depth with `--mode`. `--force` runs it again when fresh knowledge exists.",
    examples: [{ title: "Analyze a portal", command: "exactl portal knowledge analyze api --mode deep" }],
    seeAlso: [exactlCommand(PORTAL, KNOWLEDGE, ExaCtlVerb.SHOW), exactlCommand(PORTAL, ExaCtlVerb.REFRESH)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [PORTAL, KNOWLEDGE, ExaCtlVerb.SHOW],
    summary: "Show the gathered knowledge of a portal",
    description: "Prints the architecture overview, the key files, the conventions and the dependencies.",
    examples: [
      { title: "Show the knowledge", command: "exactl portal knowledge show api" },
      { title: "Show it as JSON", command: "exactl portal knowledge show api -o json" },
    ],
    seeAlso: [exactlCommand(PORTAL, KNOWLEDGE, ExaCtlVerb.ANALYZE), exactlCommand(PORTAL, ExaCtlVerb.SHOW)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.ITEM,
  },
];
