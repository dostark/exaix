/**
 * @module ContextError
 * @path packages/core/src/errors/context_error.ts
 * @description Enhanced error class with structured context preservation and cause chaining, addressing security audit requirements for traceable errors.
 * @architectural-layer Errors
 * @related-files ["packages/core/src/errors/context_error.ts", "packages/core/src/logger/event_logger.ts"]
 */

/**
 * Context data attached to errors for debugging
 */
export interface IErrorContext {
  [key: string]: string | number | boolean | null | undefined;
}

export class ContextError extends Error {
  public readonly context: IErrorContext;
  public override readonly cause?: Error;

  constructor(
    message: string,
    context: IErrorContext,
    cause?: Error,
  ) {
    super(message);
    this.name = "ContextError";
    this.context = { ...context }; // Defensive copy
    this.cause = cause;

    // Preserve original stack trace by chaining it
    if (cause && cause.stack) {
      // Use setTimeout to ensure stack is fully captured
      // This is a common pattern for preserving stack traces
      const originalStack = this.stack;
      this.stack = `${originalStack}\nCaused by: ${cause.stack}`;
    }
  }

  /**
   * JSON serialization for logging and debugging
   * Includes all error context while safely handling cause
   */
  toJSON(): {
    name: string;
    message: string;
    context: IErrorContext;
    stack: string | undefined;
    cause: { name: string; message: string } | undefined;
  } {
    return {
      name: this.name,
      message: this.message,
      context: this.context,
      stack: this.stack,
      cause: this.cause instanceof Error
        ? {
          name: this.cause.name,
          message: this.cause.message,
        }
        : undefined,
    };
  }
}
