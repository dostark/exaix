/**
 * @module CLICommandInterface
 * @path packages/cli/src/base/command.ts
 * @related-files []
 * @description Defines the standard interfaces and abstract classes for CLI commands, following the Command pattern.
 * @architectural-layer CLI
 * @ungrounded
 */

import type { JSONValue } from "@exaix/core";

export interface IHelperResult {
  success: boolean;
  message?: string;
  data?: JSONValue;
}

export interface IValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface ICommandArgs {
  [key: string]: JSONValue;
}

/**
 * Standard interface for all CLI commands.
 */
export interface ICommand<T = void> {
  name: string;
  description: string;

  /**
   * Execute the command with the given arguments.
   * @param args Command arguments
   */
  execute(args: ICommandArgs): Promise<T>;

  /**
   * Validate the command arguments.
   * @param args Command arguments
   */
  validate(args: ICommandArgs): IValidationResult;
}

/**
 * Abstract base class for commands to inherit common functionality.
 */
export abstract class AbstractCommand<T = void> implements ICommand<T> {
  abstract name: string;
  abstract description: string;

  abstract execute(args: ICommandArgs): Promise<T>;

  validate(_args: ICommandArgs): IValidationResult {
    return { isValid: true, errors: [] };
  }
}
