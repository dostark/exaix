/**
 * @module GracefulShutdownTestHelpers
 * @path packages/testing/src/helpers/services/graceful_shutdown_test_helpers.ts
 * @related-files []
 * @architectural-layer Testing
 * @ungrounded
 * @description Provides common utilities for verifying process termination logic,
 * coordinating mock signal emission and LIFO task execution checks.
 */

import { type Spy, spy } from "@std/testing/mock";
import type { IStructuredLogger } from "@exaix/core/logger";

/**
 * Interface that combines IStructuredLogger with Spies for testing
 */
export interface IMockStructuredLogger extends IStructuredLogger {
  setContext: Spy;
  child: Spy;
  debug: Spy;
  info: Spy;
  warn: Spy;
  error: Spy;
  fatal: Spy;
  time: Spy;
}

/**
 * Helper functions for GracefulShutdown tests
 */

/**
 * Creates a mock logger with spy methods for testing
 */
export function createMockLogger(): IMockStructuredLogger {
  return {
    setContext: spy(() => {}),
    child: spy(() => ({} as IStructuredLogger)),
    debug: spy(() => {}),
    info: spy(() => {}),
    warn: spy(() => {}),
    error: spy(() => {}),
    fatal: spy(() => {}),
    time: spy((_op: string, fn: () => Promise<unknown>) => fn()),
  } as IMockStructuredLogger;
}
