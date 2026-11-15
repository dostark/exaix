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
import { ConfigKeyNotFoundError } from "@exaix/core/config";
import { RequestNotFoundError } from "@exaix/core/errors";
import { FlowNotFoundError } from "@exaix/flow";
import { PortalNotFoundError } from "@exaix/portal";

const NOT_FOUND_ERRORS: ReadonlyArray<abstract new (...args: never[]) => Error> = [
  PortalNotFoundError,
  FlowNotFoundError,
  RequestNotFoundError,
  ConfigKeyNotFoundError,
];

/** The error a failed command throws. An ExaCtlError keeps its code, a missing entity becomes NOT_FOUND and any other error becomes a FAILURE. */
export function toExaCtlError<TError>(error: TError): ExaCtlError {
  if (error instanceof ExaCtlError) return error;
  const missing = NOT_FOUND_ERRORS.some((type) => error instanceof type);
  return new ExaCtlError(
    missing ? ExaCtlExitCode.NOT_FOUND : ExaCtlExitCode.FAILURE,
    error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
  );
}

/** Ends the failed command by throwing its error to the root error handler. */
export function failCommand<TError>(error: TError): never {
  throw toExaCtlError(error);
}
