/**
 * @module ExaCtlCommandFailure
 * @path apps/exactl/src/command_builders/command_failure.ts
 * @description Prints the error of a failed command through the display and ends the process with exit code 1.
 * @architectural-layer CLI
 * @dependencies [@exaix/core]
 * @related-files [apps/exactl/src/command_builders/portal_command.ts, apps/exactl/src/command_builders/git_command.ts]
 */

import { DEFAULT_UNKNOWN_ERROR_MESSAGE } from "@exaix/core";
import type { IDisplayService } from "@exaix/core/types";

/** Reports the failure of `action` and exits with code 1. */
export function failCommand(display: IDisplayService, action: string, error: Error): never {
  display.error("cli.error", action, {
    message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
  });
  return Deno.exit(1);
}
