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
import { findRename, renameHint } from "./exactl_renames.ts";

const OPTION_PREFIX = "-";

/** The typed words up to the first option token. */
function leadingWords(argv: readonly string[]): readonly string[] {
  const optionIndex = argv.findIndex((word) => word.startsWith(OPTION_PREFIX));
  return optionIndex === -1 ? argv : argv.slice(0, optionIndex);
}

/** Handles a parser or action failure. It calls `exit` for every error it handles and returns for any other. */
export function handleExaCtlError(
  error: Error,
  argv: readonly string[],
  exit: (code: number) => never,
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
  }
}
