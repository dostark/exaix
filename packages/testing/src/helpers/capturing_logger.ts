/**
 * @module CapturingLogger
 * @path packages/testing/src/helpers/capturing_logger.ts
 * @description An in-memory `IEventLogger` that records every emitted event into a caller-owned array, so tests assert on the journal.
 * @architectural-layer Testing
 * @dependencies [@exaix/core/logger, @exaix/core/types]
 * @related-files [packages/testing/mod.ts]
 */

import type { IEventLogger } from "@exaix/core/logger";
import type { LogMetadata, Opt, Reason } from "@exaix/core/types";

/** One event that a capturing logger recorded. */
export interface ICapturedEvent {
  action: string;
  target: string | null;
  payload?: LogMetadata;
}

/** Builds a logger whose `log`, level methods, and child loggers all append to `captured`. */
export function createCapturingLogger(captured: ICapturedEvent[]): IEventLogger {
  const record = (
    action: string,
    target: string | null,
    payload: Opt<LogMetadata, Reason.OptionalInput>,
  ): Promise<void> => {
    captured.push({ action, target, payload });
    return Promise.resolve();
  };
  const logger: IEventLogger = {
    log: (event) => record(event.action ?? "", event.target ?? null, event.payload),
    info: record,
    warn: record,
    error: record,
    fatal: record,
    debug: record,
    child: () => logger,
  };
  return logger;
}
