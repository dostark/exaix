/**
 * @module ExaCtlErrorHandler
 * @path apps/exactl/src/exactl_error_handler.ts
 * @description The root error handler of exactl. It maps ExaCtlError to exit codes and prints rename hints.
 * @architectural-layer CLI
 * @dependencies [@cliffy/command]
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_renames.ts, apps/exactl/src/exactl_errors.ts]
 */

import { ValidationError } from "@cliffy/command";
import { ExaCtlError, ExaCtlExitCode } from "./exactl_errors.ts";
import {
  findOptionRename,
  findRename,
  leadingWords,
  optionRenameHint,
  renameHint,
  REQUEST_NOUN,
  requestCreateHint,
} from "./exactl_renames.ts";

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
  if (error instanceof ExaCtlError) {
    console.error(error.message);
    exit(error.code);
  }
  if (error instanceof ValidationError) {
    const typed = leadingWords(argv);
    const rename = findRename(typed);
    if (rename !== null) {
      console.error(renameHint(rename, typed));
      exit(ExaCtlExitCode.USAGE);
    }
    const optionRename = findOptionRename(argv);
    if (optionRename !== null) {
      console.error(optionRenameHint(optionRename));
      exit(ExaCtlExitCode.USAGE);
    }
    if (isRequestFreeText(typed, root)) {
      console.error(requestCreateHint(typed.slice(1)));
      exit(ExaCtlExitCode.USAGE);
    }
  }
}
