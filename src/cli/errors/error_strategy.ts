/**
 * @module CLIErrorStrategy
 * @path src/cli/errors/error_strategy.ts
 * @description Defines the default error handling strategy for CLI commands, ensuring consistent error reporting and exit codes.
 * @architectural-layer CLI
 * * @related-files [src/cli/exactl.ts]
 */

export type ErrorPayload = Error | string | object | null | undefined;

export type ErrorArgs = object | null | undefined;

export interface IErrorContext {
  commandName: string;
  args?: ErrorArgs;
  error: ErrorPayload;
}

/**
 * Strategy interface for handling command errors
 */
export interface ErrorStrategy {
  handle(context: IErrorContext): Promise<void>;
}

/**
 * Fail fast strategy: logs and throws immediately
 */
export class FailFastStrategy implements ErrorStrategy {
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

/**
 * Silent strategy: suppresses errors (useful for optional operations)
 */
export class SilentStrategy implements ErrorStrategy {
  async handle(_context: IErrorContext): Promise<void> {
    // Intentionally do nothing
  }
}

/**
 * Default global strategy instance (FailFast)
 */
export const DefaultErrorStrategy = new FailFastStrategy();
