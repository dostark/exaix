/**
 * @module ExaCtlCompletionCommand
 * @path apps/exactl/src/command_builders/completion_command.ts
 * @description Builds the exactl completion command from the scripts of cliffy: a public noun with bash, fish and zsh, and the hidden helper that the scripts call.
 * @architectural-layer CLI
 * @dependencies [@cliffy/command, @exaix/cli]
 * @related-files [apps/exactl/src/command_docs/system_docs.ts, apps/exactl/src/exactl.ts]
 */

import { Command } from "@cliffy/command";
import { CompletionsCommand } from "@cliffy/command/completions";
import { documented } from "@exaix/cli";
import { ExaCtlCommandName } from "../exactl_constants.ts";
import { commandDocFor, nounDocFor } from "../command_docs/mod.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";

const COMPLETION = ExaCtlCommandName.COMPLETION;
const SHELLS = ["bash", "fish", "zsh"] as const;
const HELPER = "complete";
/** The generated scripts call `exactl completions complete`, so cliffy's own hidden command stays under that name. */
export const SCRIPT_CALLBACK_COMMAND = "completions";

function createCompletionCommand() {
  // cliffy hides its whole completions command, so the noun is rebuilt around its children.
  const source = new CompletionsCommand();
  const completion = documentedNoun(new Command(), nounDocFor(COMPLETION))
    .action(function () {
      this.showHelp();
    });
  for (const shell of SHELLS) {
    const script = source.getCommand(shell, true);
    if (script === undefined) throw new Error(`COMPLETION_SCRIPT_MISSING: ${shell}`);
    completion.command(shell, documented(script, commandDocFor([COMPLETION, shell]), []));
  }
  const helper = source.getCommand(HELPER, true);
  if (helper === undefined) throw new Error(`COMPLETION_HELPER_MISSING: ${HELPER}`);
  return completion.command(HELPER, helper.hidden());
}

export function buildCompletionCommand(): ReturnType<typeof createCompletionCommand> {
  return createCompletionCommand();
}

/** The hidden command that the generated scripts call back into. */
export function buildScriptCallbackCommand(): CompletionsCommand {
  return new CompletionsCommand().hidden();
}
