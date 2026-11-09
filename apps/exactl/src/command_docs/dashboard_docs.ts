/**
 * @module DashboardCommandDocs
 * @path apps/exactl/src/command_docs/dashboard_docs.ts
 * @description The doc record of the exactl dashboard command.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_builders/dashboard_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { ExaCtlCommandName, ExaCtlVerb } from "../exactl_constants.ts";
import { exactlCommand } from "./doc_helpers.ts";

export const DASHBOARD_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [ExaCtlCommandName.DASHBOARD],
    summary: "Open the interactive dashboard",
    description:
      "Opens the terminal dashboard. It takes over the terminal until you quit it and prints no data of its own.",
    examples: [{ title: "Open the dashboard", command: "exactl dashboard" }],
    seeAlso: [
      exactlCommand(ExaCtlCommandName.REQUEST, "list"),
      exactlCommand(ExaCtlCommandName.DAEMON, ExaCtlVerb.STATUS),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.PROTOCOL,
  },
];
