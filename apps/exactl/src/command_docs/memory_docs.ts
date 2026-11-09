/**
 * @module MemoryCommandDocs
 * @path apps/exactl/src/command_docs/memory_docs.ts
 * @description The doc records of the exactl memory noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_builders/memory_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import { exactlCommand } from "./doc_helpers.ts";

const MEMORY = ExaCtlCommandName.MEMORY;
const PROJECT = ExaCtlSubNoun.PROJECT;
const EXECUTION = ExaCtlSubNoun.EXECUTION;
const PROPOSAL = ExaCtlSubNoun.PROPOSAL;
const NOT_FOUND = [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND];

export const MEMORY_NOUN_DOC: IExaCtlNounDoc = {
  noun: MEMORY,
  group: ExaCtlCommandGroup.OPERATIONS,
  summary: "Read and manage the memory banks",
  description:
    "The memory banks hold what the agents learned: project memory per portal, the execution history, global learnings and the proposals that wait for approval.",
  lifecycle: [],
};

export const MEMORY_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [MEMORY, ExaCtlVerb.LIST],
    summary: "Show the memory banks summary",
    description: "Shows how many projects and executions the memory banks hold and when they were last active.",
    examples: [
      { title: "Show the summary", command: "exactl memory list" },
      { title: "Show the summary as JSON", command: "exactl memory list -o json" },
    ],
    seeAlso: [exactlCommand(MEMORY, PROJECT, ExaCtlVerb.LIST), exactlCommand(MEMORY, EXECUTION, ExaCtlVerb.LIST)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [MEMORY, ExaCtlVerb.SEARCH],
    summary: "Search the memory banks",
    description:
      "Searches every memory bank for the query. Narrow it with `--portal` or `--tags`, or use `--use-embeddings` for a semantic search.",
    examples: [
      { title: "Search for a word", command: "exactl memory search retry" },
      { title: "Search one portal", command: "exactl memory search retry --portal api --limit 5" },
    ],
    seeAlso: [exactlCommand(MEMORY, ExaCtlVerb.LIST), exactlCommand(MEMORY, PROJECT, ExaCtlVerb.SHOW)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [MEMORY, PROJECT, ExaCtlVerb.LIST],
    summary: "List the project memories",
    description: "Lists every project memory with its pattern and decision counts.",
    examples: [{ title: "List project memories", command: "exactl memory project list" }],
    seeAlso: [exactlCommand(MEMORY, PROJECT, ExaCtlVerb.SHOW), exactlCommand(MEMORY, ExaCtlVerb.SEARCH)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [MEMORY, PROJECT, ExaCtlVerb.SHOW],
    summary: "Show the memory of one project",
    description: "Shows the overview, the patterns, the decisions and the references of the portal.",
    examples: [{ title: "Show a project memory", command: "exactl memory project show api" }],
    seeAlso: [exactlCommand(MEMORY, PROJECT, ExaCtlVerb.LIST), exactlCommand(MEMORY, EXECUTION, ExaCtlVerb.LIST)],
    exitCodes: NOT_FOUND,
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [MEMORY, EXECUTION, ExaCtlVerb.LIST],
    summary: "List the execution history",
    description:
      "Lists the recorded executions, newest first. Filter by portal and set how many to show with `--limit`.",
    examples: [
      { title: "List executions", command: "exactl memory execution list" },
      { title: "List the last five executions of a portal", command: "exactl memory execution list --portal api -n 5" },
    ],
    seeAlso: [exactlCommand(MEMORY, EXECUTION, ExaCtlVerb.SHOW), exactlCommand(MEMORY, ExaCtlVerb.LIST)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [MEMORY, EXECUTION, ExaCtlVerb.SHOW],
    summary: "Show one recorded execution",
    description: "Shows the status, the summary, the context files, the changes and the lessons of the execution.",
    examples: [{ title: "Show an execution", command: "exactl memory execution show 7b1d4e60" }],
    seeAlso: [exactlCommand(MEMORY, EXECUTION, ExaCtlVerb.LIST), exactlCommand(MEMORY, PROJECT, ExaCtlVerb.SHOW)],
    exitCodes: NOT_FOUND,
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [MEMORY, ExaCtlSubNoun.LEARNING, ExaCtlVerb.REMOVE],
    summary: "Remove a global learning",
    description: "Marks the learning as deleted. The record stays for the audit trail.",
    examples: [{ title: "Remove a learning", command: 'exactl memory learning remove l-1 --reason "Out of date"' }],
    seeAlso: [exactlCommand(MEMORY, ExaCtlVerb.SEARCH), exactlCommand(MEMORY, PROPOSAL, ExaCtlVerb.LIST)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [MEMORY, ExaCtlSubNoun.INDEX, ExaCtlVerb.REBUILD],
    summary: "Rebuild the memory search indices",
    description:
      "Rebuilds the search indices of the memory banks. `--include-embeddings` also regenerates every embedding vector.",
    examples: [{ title: "Rebuild the indices", command: "exactl memory index rebuild" }],
    seeAlso: [exactlCommand(MEMORY, ExaCtlVerb.SEARCH), exactlCommand(MEMORY, ExaCtlVerb.LIST)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [MEMORY, PROPOSAL, ExaCtlVerb.LIST],
    summary: "List the pending memory proposals",
    description:
      "Lists the proposals that wait for approval. `--eligible` shows only the ones that auto-approval would take.",
    examples: [{ title: "List pending proposals", command: "exactl memory proposal list" }],
    seeAlso: [exactlCommand(MEMORY, PROPOSAL, ExaCtlVerb.SHOW), exactlCommand(MEMORY, PROPOSAL, ExaCtlVerb.APPROVE)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [MEMORY, PROPOSAL, ExaCtlVerb.SHOW],
    summary: "Show one pending proposal",
    description: "Shows the learning that the proposal would add and the scope it would merge into.",
    examples: [{ title: "Show a proposal", command: "exactl memory proposal show prop-1" }],
    seeAlso: [exactlCommand(MEMORY, PROPOSAL, ExaCtlVerb.APPROVE), exactlCommand(MEMORY, PROPOSAL, ExaCtlVerb.REJECT)],
    exitCodes: NOT_FOUND,
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [MEMORY, PROPOSAL, ExaCtlVerb.APPROVE],
    summary: "Approve pending proposals",
    description:
      "Approves the listed proposals, or every pending proposal with `--all`. `--dry-run` lists what auto-approval would take and changes nothing.",
    examples: [
      { title: "Approve one proposal", command: "exactl memory proposal approve prop-1" },
      { title: "Approve every proposal", command: "exactl memory proposal approve --all" },
      { title: "Preview auto-approval", command: "exactl memory proposal approve --dry-run" },
    ],
    seeAlso: [exactlCommand(MEMORY, PROPOSAL, ExaCtlVerb.SHOW), exactlCommand(MEMORY, PROPOSAL, ExaCtlVerb.REJECT)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [MEMORY, PROPOSAL, ExaCtlVerb.REJECT],
    summary: "Reject a pending proposal",
    description: "Rejects the proposal and records the reason.",
    examples: [{ title: "Reject a proposal", command: 'exactl memory proposal reject prop-1 --reason "Too narrow"' }],
    seeAlso: [exactlCommand(MEMORY, PROPOSAL, ExaCtlVerb.SHOW), exactlCommand(MEMORY, PROPOSAL, ExaCtlVerb.APPROVE)],
    exitCodes: NOT_FOUND,
    output: ExaCtlOutputKind.MUTATION,
  },
];
