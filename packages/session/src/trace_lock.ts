/**
 * @module TraceLock
 * @path packages/session/src/trace_lock.ts
 * @description Serializes async operations per trace id, so two writers of one trace never interleave.
 * @architectural-layer Services
 * @related-files ["packages/session/src/session_delegation_result_store.ts", "packages/session/src/session_return_processor.ts"]
 */

/** Runs operations for the same trace one after another, in call order. Different traces run independently. */
export class TraceLock {
  private readonly traceQueues = new Map<string, Promise<void>>();

  async run<T>(traceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.traceQueues.get(traceId) ?? Promise.resolve();
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve: () => void): void => {
      release = resolve;
    });
    const queued = previous.then((): Promise<void> => pending);
    this.traceQueues.set(traceId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.traceQueues.get(traceId) === queued) this.traceQueues.delete(traceId);
    }
  }
}
