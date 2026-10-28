/**
 * @module SafeError
 * @path packages/core/src/errors/safe_error.ts
 * @description Safe error wrapper that prevents information leakage by providing user-safe messages while securely logging internal details.
 * @architectural-layer Core
 * @ungrounded
 * @related-files ["packages/core/src/errors/safe_error.ts", "packages/core/src/logger/event_logger.ts"]
 */

import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { Opt, Reason } from "@exaix/core/types";

/**
 * Safe error that prevents information leakage
 */
export class SafeError extends Error {
  public readonly errorCode: string;

  constructor(
    userMessage: string,
    errorCode: string,
    internalError?: Opt<Error, Reason.OptionalInput>,
    logger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ) {
    super(userMessage);
    this.name = "SafeError";
    this.errorCode = errorCode;

    // Log internal error details securely if logger is provided
    if (logger && internalError) {
      logger.error(DomainEventType.SafeErrorInternalDetails, "SafeError", {
        errorCode,
        userMessage,
        internalMessage: internalError.message,
        internalStack: internalError.stack ?? null,
        internalName: internalError.name,
      });
    }
  }

  /**
   * Returns safe JSON representation (excludes internal error details)
   */
  toJSON(): {
    name: string;
    message: string;
    errorCode: string;
  } {
    return {
      name: this.name,
      message: this.message,
      errorCode: this.errorCode,
    };
  }

  /**
   * Returns safe string representation
   */
  override toString(): string {
    return `${this.name}: ${this.message} (code: ${this.errorCode})`;
  }
}
