/**
 * @module SystemCommandDocs
 * @path apps/exactl/src/command_docs/system_docs.ts
 * @description The doc records of the exactl system commands: version, doctor and the completion scripts.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_builders/doctor_command.ts, apps/exactl/src/command_builders/completion_command.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { ExaCtlCommandName, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import { exactlCommand } from "./doc_helpers.ts";

const COMPLETION = ExaCtlCommandName.COMPLETION;
const SHELLS = ["bash", "fish", "zsh"] as const;

export const COMPLETION_NOUN_DOC: IExaCtlNounDoc = {
  noun: COMPLETION,
  group: ExaCtlCommandGroup.SYSTEM,
  summary: "Print shell completion scripts",
  description:
    "A completion script lets your shell complete exactl commands and options with the Tab key. Each shell has its own script.\n\nSource the script in your shell profile, for example `source <(exactl completion bash)` in `~/.bashrc`.",
  lifecycle: [],
};

function shellDoc(shell: (typeof SHELLS)[number]): IExaCtlCommandDoc {
  return {
    path: [COMPLETION, shell],
    summary: `Print the ${shell} completion script`,
    description:
      `Prints the ${shell} completion script to stdout. It changes nothing on its own: source it from your shell profile.`,
    examples: [{ title: `Print the ${shell} script`, command: `exactl completion ${shell}` }],
    seeAlso: SHELLS.filter((other) => other !== shell).map((other) => exactlCommand(COMPLETION, other)),
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.PROTOCOL,
  };
}

export const SYSTEM_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [ExaCtlCommandName.VERSION],
    summary: "Show the binary and workspace schema versions",
    description:
      "Prints the version of the exactl binary, the schema version of the workspace and whether the two are compatible.",
    examples: [{ title: "Show the versions", command: "exactl version" }],
    seeAlso: [exactlCommand(ExaCtlCommandName.DOCTOR), exactlCommand(ExaCtlCommandName.DAEMON, ExaCtlVerb.STATUS)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [ExaCtlCommandName.DOCTOR],
    summary: "Check the health of the installation",
    description:
      "Runs five read-only checks and prints one row for each: `schema` (binary against workspace), `config` (the configuration file), `daemon` (the PID file), `provider` (the default provider starts) and `pricing` (the models that have no price or an old one).\n\nA check is `PASS`, `WARN` or `FAIL`. A warning never fails the command: a stopped daemon or an old price only tells you where numbers rest on weak data. The exit code is the class of the first failing check: 6 for the schema or the configuration, 5 for a dead daemon process and 7 for a missing credential. `--schema` runs only the schema check.",
    examples: [
      { title: "Check everything", command: "exactl doctor" },
      { title: "Check only the schema", command: "exactl doctor --schema" },
      { title: "Print the checks as JSON", command: "exactl doctor -o json" },
    ],
    seeAlso: [
      exactlCommand(ExaCtlCommandName.CONFIG, ExaCtlVerb.VALIDATE),
      exactlCommand(ExaCtlCommandName.DAEMON, ExaCtlVerb.STATUS),
      exactlCommand(ExaCtlCommandName.MODEL, ExaCtlVerb.LIST),
    ],
    exitCodes: [ExaCtlExitCode.INVALID, ExaCtlExitCode.DAEMON_UNAVAILABLE, ExaCtlExitCode.CREDENTIALS],
    output: ExaCtlOutputKind.COLLECTION,
  },
  ...SHELLS.map(shellDoc),
];
