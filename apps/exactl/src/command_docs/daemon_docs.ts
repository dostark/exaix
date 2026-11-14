/**
 * @module DaemonCommandDocs
 * @path apps/exactl/src/command_docs/daemon_docs.ts
 * @description The doc records of the exactl daemon noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_builders/daemon_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { ExaCtlCommandName, ExaCtlVerb } from "../exactl_constants.ts";
import { exactlCommand } from "./doc_helpers.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";

const DAEMON = ExaCtlCommandName.DAEMON;

export const DAEMON_NOUN_DOC: IExaCtlNounDoc = {
  noun: DAEMON,
  group: ExaCtlCommandGroup.OPERATIONS,
  summary: "Control the Exaix daemon",
  description:
    "The daemon watches the workspace and runs requests, plans and flows. Start it before you create requests, and stop it before you move the workspace.",
  lifecycle: [],
};

export const DAEMON_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [DAEMON, ExaCtlVerb.START],
    summary: "Start the Exaix daemon",
    description: "Starts the daemon and waits until it reports ready. Set the wait with `--ready-timeout`.",
    examples: [{ title: "Start the daemon", command: "exactl daemon start" }],
    seeAlso: [exactlCommand(DAEMON, ExaCtlVerb.STATUS), exactlCommand(DAEMON, ExaCtlVerb.STOP)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [DAEMON, ExaCtlVerb.STOP],
    summary: "Stop the Exaix daemon",
    description: "Stops the running daemon. A request that is running finishes its current step first.",
    examples: [{ title: "Stop the daemon", command: "exactl daemon stop" }],
    seeAlso: [exactlCommand(DAEMON, ExaCtlVerb.STATUS), exactlCommand(DAEMON, ExaCtlVerb.START)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [DAEMON, ExaCtlVerb.RESTART],
    summary: "Restart the Exaix daemon",
    description: "Stops the daemon and starts it again, so it reloads the configuration.",
    examples: [{ title: "Restart the daemon", command: "exactl daemon restart" }],
    seeAlso: [exactlCommand(DAEMON, ExaCtlVerb.STATUS), exactlCommand(DAEMON, ExaCtlVerb.LOGS)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [DAEMON, ExaCtlVerb.STATUS],
    summary: "Check whether the daemon runs",
    description: "Prints the daemon state, its process id and uptime, and the binary and workspace schema versions.",
    examples: [
      { title: "Show the daemon status", command: "exactl daemon status" },
      { title: "Show the daemon status as JSON", command: "exactl daemon status -o json" },
    ],
    seeAlso: [exactlCommand(DAEMON, ExaCtlVerb.START), exactlCommand(DAEMON, ExaCtlVerb.LOGS)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [DAEMON, ExaCtlVerb.LOGS],
    summary: "Show the daemon logs",
    description:
      "Prints the last lines of the daemon log. With `--follow` it keeps printing new lines until you stop it.",
    examples: [
      { title: "Show the last 50 lines", command: "exactl daemon logs --limit 50" },
      { title: "Follow the log", command: "exactl daemon logs --follow" },
    ],
    seeAlso: [exactlCommand(DAEMON, ExaCtlVerb.STATUS), exactlCommand(DAEMON, ExaCtlVerb.RESTART)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.PROTOCOL,
  },
];
