/**
 * @module CliProcessMutex
 * @path tests/helpers/cli_process_mutex.ts
 * @description Serializes CLI subprocess executions in tests to avoid parallel
 * environment/process interference.
 */

let queue: Promise<void> = Promise.resolve();

/**
 * Run a function under a process-wide FIFO mutex.
 */
export async function withCliProcessMutex<T>(fn: () => Promise<T>): Promise<T> {
  const previous = queue;
  let release: () => void;
  queue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await fn();
  } finally {
    release!();
  }
}
