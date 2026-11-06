/**
 * @module ExaCtlErrors
 * @path apps/exactl/src/exactl_errors.ts
 * @description The process exit codes of exactl and the error type that carries one to the root error handler.
 * @architectural-layer CLI
 * @dependencies []
 * @related-files [apps/exactl/src/exactl_error_handler.ts, apps/exactl/src/exactl.ts]
 */

/** Process exit codes of exactl. */
export enum ExaCtlExitCode {
  OK = 0,
  FAILURE = 1,
  USAGE = 2,
  NOT_FOUND = 3,
  STATE_CONFLICT = 4,
  DAEMON_UNAVAILABLE = 5,
  INVALID = 6,
  CREDENTIALS = 7,
  TIMEOUT = 124,
  CANCELLED = 130,
}

/** A failure that carries its exit code to the root error handler. */
export class ExaCtlError extends Error {
  constructor(readonly code: ExaCtlExitCode, message: string) {
    super(message);
    this.name = "ExaCtlError";
  }
}
