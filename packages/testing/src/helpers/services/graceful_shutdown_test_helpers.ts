/**
 * @module GracefulShutdownTestHelpers
 * @path packages/testing/src/helpers/services/graceful_shutdown_test_helpers.ts
 * @description Provides mock logger utilities for testing graceful shutdown behavior,
 * including IMockEventLogger interface and createMockLogger factory function.
 * @architectural-layer Testing
 * @related-files ["apps/daemon/src/graceful_shutdown.ts", "packages/core/src/logger/event_logger.ts"]
 */
import { type Spy, spy } from "@std/testing/mock";
import type { IEventLogger } from "@exaix/core/logger";

export interface IMockEventLogger extends IEventLogger {
  log: Spy<IEventLogger["log"]>;
  info: Spy<IEventLogger["info"]>;
  warn: Spy<IEventLogger["warn"]>;
  error: Spy<IEventLogger["error"]>;
  fatal: Spy<IEventLogger["fatal"]>;
  debug: Spy<IEventLogger["debug"]>;
  child: Spy<IEventLogger["child"]>;
}

export function createMockLogger(): IMockEventLogger {
  return {
    log: spy(() => Promise.resolve()),
    info: spy(() => Promise.resolve()),
    warn: spy(() => Promise.resolve()),
    error: spy(() => Promise.resolve()),
    fatal: spy(() => Promise.resolve()),
    debug: spy(() => Promise.resolve()),
    child: spy(() => ({} as IEventLogger)),
  } as IMockEventLogger;
}
