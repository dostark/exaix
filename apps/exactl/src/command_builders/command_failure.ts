/**
 * @module ExaCtlCommandFailure
 * @path apps/exactl/src/command_builders/command_failure.ts
 * @description Turns the error of a failed command into the ExaCtlError that the root error handler maps to an exit code.
 * @architectural-layer CLI
 * @dependencies [@exaix/core, @exaix/cli]
 * @related-files [apps/exactl/src/command_builders/portal_command.ts, apps/exactl/src/command_builders/git_command.ts, apps/exactl/src/exactl_error_handler.ts]
 */

import { DEFAULT_UNKNOWN_ERROR_MESSAGE } from "@exaix/core";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";

/** The error a failed command throws. An ExaCtlError keeps its code and any other error becomes a FAILURE. */
export function toExaCtlError(error: Error): ExaCtlError {
  if (error instanceof ExaCtlError) return error;
  return new ExaCtlError(
    ExaCtlExitCode.FAILURE,
    error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
  );
}

/** Ends the failed command by throwing its error to the root error handler. */
export function failCommand(error: Error): never {
  throw toExaCtlError(error);
}
