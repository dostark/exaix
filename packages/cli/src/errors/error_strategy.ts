/**
 * @module CLIErrorStrategy
 * @path packages/cli/src/errors/error_strategy.ts
 * @description Defines the default error handling strategy for CLI commands, ensuring consistent error reporting and exit codes.
 * @architectural-layer CLI
 * @ungrounded
 * @related-files [packages/cli/tests/errors/error_strategy_test.ts]
 */

export type ErrorPayload = Error | string | object | null | undefined;

export type ErrorArgs = object | null | undefined;

export interface IErrorContext {
  commandName: string;
  args?: ErrorArgs;
  error: ErrorPayload;
}

export interface IErrorStrategy {
  handle(context: IErrorContext): Promise<void>;
}

export class FailFastStrategy implements IErrorStrategy {
  handle(context: IErrorContext): Promise<void> {
    console.error(`Error executing ${context.commandName}:`);
    if (context.error instanceof Error) {
      console.error(context.error.message);
    } else {
      console.error(String(context.error));
    }
    throw context.error;
  }
}

export class SilentStrategy implements IErrorStrategy {
  async handle(_context: IErrorContext): Promise<void> {
  }
}

export const DefaultErrorStrategy = new FailFastStrategy();
