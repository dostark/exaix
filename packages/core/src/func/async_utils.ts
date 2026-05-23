/**
 * @module AsyncUtils
 * @path packages/core/src/func/async_utils.ts
 * @related-files []
 * @architectural-layer Core
 * @description Asynchronous utilities for non-blocking operations and delays.
 */

/**
 * Non-blocking delay utility.
 * @param ms Milliseconds to delay.
 * @returns Promise that resolves after the requested delay.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
