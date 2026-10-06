/**
 * @module NoopEventLogger
 * @path packages/core/src/logger/noop_event_logger.ts
 * @description The single no-op IEventLogger, used where a component runs without an
 *   injected logger and must not journal.
 * @architectural-layer Services
 * @related-files [packages/core/src/logger/event_logger.ts]
 */

import type { IEventLogger } from "./event_logger.ts";

/** An IEventLogger that discards every event. Its child is itself. */
export function createNoopEventLogger(): IEventLogger {
  const discard = (): Promise<void> => Promise.resolve();
  const logger: IEventLogger = {
    log: discard,
    info: discard,
    warn: discard,
    error: discard,
    fatal: discard,
    debug: discard,
    child: () => logger,
  };
  return logger;
}
