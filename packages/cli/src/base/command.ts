/**
 * @module CLICommandInterface
 * @path packages/cli/src/base/command.ts
 * @related-files []
 * @description Defines the standard interfaces and abstract classes for CLI commands, following the Command pattern.
 * @architectural-layer CLI
 * @ungrounded
 */

import type { JSONValue } from "@exaix/core";

export interface IValidationResult {
  isValid: boolean;
  errors: string[];
}

interface ICommandArgs {
  [key: string]: JSONValue;
}

/**
 * Standard interface for all CLI commands.
 */
interface ICommand<T = void> {
  name: string;
  description: string;

  /** Execute the command with the given arguments. */
  execute(args: ICommandArgs): Promise<T>;

  /** Validate the command arguments. */
  validate(args: ICommandArgs): IValidationResult;
}
