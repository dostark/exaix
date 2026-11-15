/**
 * @module ExaCtlErrorHandler
 * @path apps/exactl/src/exactl_error_handler.ts
 * @description The root error handler of exactl. It maps ExaCtlError to exit codes and prints rename hints.
 * @architectural-layer CLI
 * @dependencies [@cliffy/command]
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_renames.ts, packages/cli/src/errors/exactl_errors.ts]
 */

import { ValidationError } from "@cliffy/command";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import {
  findOptionRename,
  findRename,
  leadingWords,
  optionRenameHint,
  renameHint,
  REQUEST_NOUN,
  requestCreateHint,
  stripGlobalOptions,
} from "./exactl_renames.ts";
import { isJsonOutputRequested, stripTerminalControls } from "./output/exactl_output.ts";

const CHILD_EXIT_NAME = "CHILD_EXIT";

/** The name of the exit code of an error. CHILD_EXIT is the name of a code that a child process passed through. */
function exitCodeName(error: ExaCtlError): string {
  return error.childExit ? CHILD_EXIT_NAME : ExaCtlExitCode[error.code] ?? CHILD_EXIT_NAME;
}

/** Prints a failure to stderr: the JSON error shape in a machine format, plain text otherwise. */
function reportFailure(json: boolean, code: string, message: string): void {
  console.error(json ? JSON.stringify({ error: { code, message } }) : message);
}

/** The part of the root command the handler reads to tell a subcommand from free text. */
interface ICommandLookup {
  getCommand(name: string): { hasCommand(name: string): boolean } | undefined;
}

/** True when the words are `request` followed by a word that is not a request subcommand. */
function isRequestFreeText(typed: readonly string[], root: ICommandLookup): boolean {
  return typed[0] === REQUEST_NOUN && typed.length > 1 &&
    root.getCommand(REQUEST_NOUN)?.hasCommand(typed[1]) === false;
}

/** Handles a parser or action failure. It calls `exit` for every error it handles and returns for any other. */
export function handleExaCtlError(
  error: Error,
  argv: readonly string[],
  exit: (code: number) => never,
  root: ICommandLookup,
): void {
  const json = isJsonOutputRequested(argv);
  if (error instanceof ExaCtlError) {
    reportFailure(json, exitCodeName(error), stripTerminalControls(error.message));
    exit(error.code);
  }
  if (error instanceof ValidationError) {
    const words = stripGlobalOptions(argv);
    const typed = leadingWords(words);
    const rename = findRename(typed);
    if (rename !== null) {
      console.error(renameHint(rename, typed));
      exit(ExaCtlExitCode.USAGE);
    }
    const optionRename = findOptionRename(argv);
    if (optionRename !== null) {
      console.error(optionRenameHint(optionRename, typed));
      exit(ExaCtlExitCode.USAGE);
    }
    if (isRequestFreeText(typed, root)) {
      console.error(requestCreateHint(typed.slice(1)));
      exit(ExaCtlExitCode.USAGE);
    }
    if (json) {
      reportFailure(json, ExaCtlExitCode[ExaCtlExitCode.USAGE], stripTerminalControls(error.message));
      exit(ExaCtlExitCode.USAGE);
    }
    return;
  }
  if (json) {
    reportFailure(json, ExaCtlExitCode[ExaCtlExitCode.FAILURE], stripTerminalControls(error.message));
    exit(ExaCtlExitCode.FAILURE);
  }
}
