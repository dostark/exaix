/**
 * @module RequestCommandDocs
 * @path apps/exactl/src/command_docs/request_docs.ts
 * @description The doc records of the exactl request noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli, @exaix/core]
 * @related-files [apps/exactl/src/command_builders/request_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { RequestStatus } from "@exaix/core/status";
import { ExaCtlCommandName, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import { exactlCommand } from "./doc_helpers.ts";

const REQUEST = ExaCtlCommandName.REQUEST;

export const REQUEST_NOUN_DOC: IExaCtlNounDoc = {
  noun: REQUEST,
  group: ExaCtlCommandGroup.WORK,
  summary: "Create and follow requests for Exaix agents and flows",
  description:
    "A request is the task you give an agent role or a multi-agent flow. The daemon picks it up, plans it and runs it.\n\nA request that needs answers waits for clarification before it plans.",
  lifecycle: [RequestStatus.PENDING, RequestStatus.PLANNED, RequestStatus.IN_PROGRESS, RequestStatus.COMPLETED],
};

export const REQUEST_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [REQUEST, ExaCtlVerb.CREATE],
    summary: "Create a request for an agent or a flow",
    description:
      "Writes a request file that the daemon processes. Give the task as text or with `--file`. Choose the agent role with `--agent` or a flow with `--flow`.\n\n- `--dry-run` shows what would be created\n- `--dry-run-context` prints the projected prompt size without writing a file",
    examples: [
      {
        title: "Create a request for an agent role",
        command: 'exactl request create "Analyze this code" --agent code-reviewer',
      },
      {
        title: "Create a request for a flow",
        command: 'exactl request create "Build a web app" --flow web-development',
      },
      {
        title: "Create a high-priority request",
        command: 'exactl request create "Fix critical bug" --priority critical --agent debugger',
      },
    ],
    seeAlso: [exactlCommand(REQUEST, ExaCtlVerb.WATCH), exactlCommand(REQUEST, ExaCtlVerb.LIST)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [REQUEST, ExaCtlVerb.LIST],
    summary: "List pending requests",
    description:
      "Lists requests that are not archived. Filter with `--status`, or add archived and rejected requests with `--all`.",
    examples: [
      { title: "List requests", command: "exactl request list" },
      { title: "List failed requests as JSON", command: "exactl request list --status failed -o json" },
    ],
    seeAlso: [exactlCommand(REQUEST, ExaCtlVerb.SHOW), exactlCommand(REQUEST, ExaCtlVerb.CREATE)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [REQUEST, ExaCtlVerb.SHOW],
    summary: "Show the details of one request",
    description: "Prints the request metadata, its analysis when there is one, and its content.",
    examples: [{ title: "Show a request", command: "exactl request show 3f2a9c1e" }],
    seeAlso: [exactlCommand(REQUEST, ExaCtlVerb.LIST), exactlCommand(REQUEST, ExaCtlVerb.WATCH)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [REQUEST, ExaCtlVerb.WATCH],
    summary: "Follow the live events of a request",
    description:
      "Streams the execution events of a request or a trace. It falls back to the stored events when the trace has finished. With `-o jsonl` it prints one event per line.",
    examples: [
      { title: "Watch a request", command: "exactl request watch 3f2a9c1e" },
      {
        title: "Watch a trace as JSON lines",
        command: "exactl request watch --trace 7b1d4e60-1c2a-4e3b-9f10-2a6c8d9e0f11 -o jsonl",
      },
    ],
    seeAlso: [exactlCommand(REQUEST, ExaCtlVerb.SHOW), exactlCommand(REQUEST, ExaCtlVerb.CANCEL)],
    exitCodes: [ExaCtlExitCode.USAGE, ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.STREAM,
  },
  {
    path: [REQUEST, ExaCtlVerb.ANALYZE],
    summary: "Analyze the intent of a request",
    description:
      "Runs the intent analysis for an existing request. Choose the engine with `--engine`, and skip the cached result with `--force`.",
    examples: [{ title: "Analyze a request", command: "exactl request analyze 3f2a9c1e --engine heuristic" }],
    seeAlso: [exactlCommand(REQUEST, ExaCtlVerb.CLARIFY), exactlCommand(REQUEST, ExaCtlVerb.SHOW)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [REQUEST, ExaCtlVerb.CANCEL],
    summary: "Cancel a pending request",
    description:
      "Cancels a request that is pending or waits for clarification. A request that already runs cannot be cancelled. Asks for confirmation first. Pass `--yes` to confirm without a prompt, as scripts must.",
    examples: [{ title: "Cancel a request", command: 'exactl request cancel 3f2a9c1e --reason "Duplicate"' }, {
      title: "Cancel without a prompt",
      command: 'exactl request cancel 3f2a9c1e --reason "Duplicate" --yes',
    }],
    seeAlso: [exactlCommand(REQUEST, ExaCtlVerb.SHOW), exactlCommand(REQUEST, ExaCtlVerb.LIST)],
    exitCodes: [
      ExaCtlExitCode.USAGE,
      ExaCtlExitCode.NOT_FOUND,
      ExaCtlExitCode.STATE_CONFLICT,
      ExaCtlExitCode.INVALID,
      ExaCtlExitCode.CANCELLED,
    ],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [REQUEST, ExaCtlVerb.CLARIFY],
    summary: "Answer the clarification questions of a request",
    description:
      "Sends answers as `id=text` pairs. Force the request on with `--proceed`, or stop the clarification with `--cancel`.",
    examples: [
      { title: "Answer a question", command: 'exactl request clarify 3f2a9c1e --answer "q1=Use the staging database"' },
      { title: "Proceed with the best-effort request", command: "exactl request clarify 3f2a9c1e --proceed" },
    ],
    seeAlso: [exactlCommand(REQUEST, ExaCtlVerb.ANALYZE), exactlCommand(REQUEST, ExaCtlVerb.SHOW)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [REQUEST, ExaCtlVerb.INSPECT],
    summary: "Inspect the captured context of a trace",
    description:
      "Reads the prompts captured for a trace without changing anything. With `--json` it prints the record. With `--raw` it writes the exact bytes of one record and refuses a terminal.",
    examples: [
      { title: "List the records of a trace", command: "exactl request inspect 7b1d4e60-1c2a-4e3b-9f10-2a6c8d9e0f11" },
      {
        title: "Print one record as JSON",
        command:
          "exactl request inspect 7b1d4e60-1c2a-4e3b-9f10-2a6c8d9e0f11 --record 5d0c2f3a-6b7e-4a18-8c90-1e2f3a4b5c6d --json",
      },
    ],
    seeAlso: [exactlCommand(REQUEST, ExaCtlVerb.SHOW), exactlCommand(REQUEST, ExaCtlVerb.WATCH)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.ITEM,
  },
];
