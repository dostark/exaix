/**
 * @module LogCommandDocs
 * @path apps/exactl/src/command_docs/log_docs.ts
 * @description The doc records of the exactl log noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_builders/log_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { ExaCtlCommandName, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import { exactlCommand } from "./doc_helpers.ts";

const LOG = ExaCtlCommandName.LOG;
const MODEL = ExaCtlCommandName.MODEL;

export const LOG_NOUN_DOC: IExaCtlNounDoc = {
  noun: LOG,
  group: ExaCtlCommandGroup.OPERATIONS,
  summary: "Read the activity journal and the cost of the LLM calls",
  description:
    "The journal records what the daemon, the agents and the commands did, and the cost report adds what each LLM call cost. Each priced call names its source: the provider, the registry price or a blended estimate.",
  lifecycle: [],
};

export const LOG_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [LOG, ExaCtlVerb.LIST],
    summary: "Query the activity journal",
    description:
      "Lists the journal rows, newest first. Filter with `--filter key=value` or a bare event name, and count or list distinct values with `--count` and `--distinct`.",
    examples: [
      { title: "Show the last rows", command: "exactl log list" },
      { title: "Filter by trace", command: "exactl log list --filter trace_id=7b1d4e60 -n 20 -o json" },
    ],
    seeAlso: [
      exactlCommand(...[LOG, ExaCtlVerb.WAIT]),
      exactlCommand(...[LOG, ExaCtlVerb.COST]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [LOG, ExaCtlVerb.WAIT],
    summary: "Wait for a journal event",
    description:
      "Blocks until one of the events is journalled after the baseline, or until the timeout. It prints the matching event as one line with `-o jsonl`.",
    examples: [
      { title: "Wait for the daemon", command: "exactl log wait --event daemon.ready --timeout 60" },
    ],
    seeAlso: [
      exactlCommand(...[LOG, ExaCtlVerb.LIST]),
      exactlCommand(...[LOG, ExaCtlVerb.VERIFY]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE, ExaCtlExitCode.TIMEOUT],
    output: ExaCtlOutputKind.STREAM,
  },
  {
    path: [LOG, ExaCtlVerb.VERIFY],
    summary: "Verify the journal hash chain",
    description: "Checks the hash chain of the activity journal. It fails with exit code 1 when a row was changed.",
    examples: [
      { title: "Verify the journal", command: "exactl log verify" },
    ],
    seeAlso: [
      exactlCommand(...[LOG, ExaCtlVerb.LIST]),
      exactlCommand(...[LOG, ExaCtlVerb.COST]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.INVALID],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [LOG, ExaCtlVerb.COST],
    summary: "Show the cost of the LLM calls",
    description:
      "Lists the recorded calls with their cost and the source of the price, or groups them with `--group-by model`, `portal` or `service`. A group shows the share of its cost per source.",
    examples: [
      { title: "List the recorded costs", command: "exactl log cost" },
      { title: "Group by service", command: "exactl log cost --group-by service -o json" },
    ],
    seeAlso: [
      exactlCommand(...[LOG, ExaCtlVerb.LIST]),
      exactlCommand(...[MODEL, ExaCtlVerb.LIST]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
];
