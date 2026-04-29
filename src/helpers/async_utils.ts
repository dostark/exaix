/**
 * @module AsyncUtils
 * @path src/helpers/async_utils.ts
 * @description Asynchronous utilities for non-blocking operations and delays.
 * @architectural-layer Helpers
 * @related-files []
 */

/**
 * Non-blocking delay utility
 * @param ms Milliseconds to delay
 * @returns Promise that resolves after the delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
