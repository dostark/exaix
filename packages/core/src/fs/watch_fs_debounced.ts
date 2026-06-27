/**
 * @module WatchFsDebounced
 * @path packages/core/src/fs/watch_fs_debounced.ts
 * @description Canonical helper for consuming Deno.watchFs safely. Deno.watchFs has NO built-in
 *   idempotency — it emits multiple/duplicate FsEvents per change, ordering varies by OS
 *   (denoland/deno#12874), so a naive `for await` loop double-processes and an uncaught handler
 *   throw kills the whole loop (the Phase 128 session-return reconcile crash). This helper encodes
 *   the correct pattern once: per-path debounce, write-kind filtering, an optional shouldProcess
 *   dedup/content guard, and per-event error isolation so one bad event never tears down the watch.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/core/src/types/constants.ts, apps/daemon/src/session_return_watcher.ts, packages/routing/src/routing_policy_loader.ts]
 */

import { DEFAULT_WATCHER_DEBOUNCE_MS, FS_WRITE_EVENT_KINDS } from "../types/constants.ts";

/** Minimal structural shape of a Deno.FsEvent (kind + affected paths) — keeps the helper testable. */
export interface IFsEventLike {
  kind: string;
  paths: string[];
}

/** Options for {@link consumeFsEvents} / {@link watchFsDebounced}. */
export interface IWatchFsDebouncedOptions {
  /** Debounce window per path (ms). Defaults to DEFAULT_WATCHER_DEBOUNCE_MS. */
  debounceMs?: number;
  /** Which event kinds to act on. Defaults to FS_WRITE_EVENT_KINDS (create/modify/rename). */
  eventKinds?: ReadonlySet<string>;
  /**
   * Optional per-path guard evaluated after debounce, before the handler. Return false to suppress
   * (the dedup/content-comparison seam — e.g. "HEAD hash unchanged" or "already processed").
   */
  shouldProcess?: (path: string) => boolean | Promise<boolean>;
  /**
   * Called when the handler (or shouldProcess) throws. The error is ISOLATED — the watch loop
   * continues. A non-Error throw is coerced to an Error before this is called. Defaults to a no-op;
   * production callers should journal it.
   */
  onError?: (error: Error, path: string) => void | Promise<void>;
  /** Abort signal; when aborted the loop stops draining events. */
  signal?: AbortSignal;
}

/**
 * Drain an async iterable of FsEvents with debounce + dedup + per-event error isolation. Accepts any
 * `AsyncIterable<IFsEventLike>` (Deno.FsWatcher satisfies it) so it is unit-testable without a real
 * filesystem. Resolves when the iterable is exhausted or `signal` aborts; pending debounced handlers
 * are flushed before returning.
 */
export async function consumeFsEvents(
  source: AsyncIterable<IFsEventLike>,
  handler: (path: string) => void | Promise<void>,
  options: IWatchFsDebouncedOptions = {},
): Promise<void> {
  const debounceMs = options.debounceMs ?? DEFAULT_WATCHER_DEBOUNCE_MS;
  const eventKinds = options.eventKinds ?? FS_WRITE_EVENT_KINDS;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Set<Promise<void>>();

  const fire = (path: string): void => {
    const p = (async () => {
      try {
        if (options.shouldProcess && !(await options.shouldProcess(path))) return;
        await handler(path);
      } catch (error) {
        // Error isolation: never let one event's failure escape the loop (would crash the host).
        await options.onError?.(error instanceof Error ? error : new Error(String(error)), path);
      }
    })();
    pending.add(p);
    void p.finally(() => pending.delete(p));
  };

  try {
    for await (const event of source) {
      if (options.signal?.aborted) break;
      if (!eventKinds.has(event.kind)) continue;
      for (const path of event.paths) {
        const existing = timers.get(path);
        if (existing) clearTimeout(existing);
        timers.set(
          path,
          setTimeout(() => {
            timers.delete(path);
            fire(path);
          }, debounceMs),
        );
      }
    }
  } finally {
    // Flush: let outstanding debounce timers fire, then await in-flight handlers so callers (and
    // tests) observe a settled state when this resolves.
    if (timers.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 1));
    }
    await Promise.all([...pending]);
  }
}

/**
 * Convenience wrapper: open a `Deno.watchFs` on `path` and consume it via {@link consumeFsEvents}.
 * Returns the live `Deno.FsWatcher` (close it to stop) and the consume promise. Use this for new
 * watchers instead of hand-rolling a `for await` loop.
 */
export function watchFsDebounced(
  path: string | string[],
  handler: (path: string) => void | Promise<void>,
  options: IWatchFsDebouncedOptions & { recursive?: boolean } = {},
): { watcher: Deno.FsWatcher; done: Promise<void> } {
  const watcher = Deno.watchFs(path, { recursive: options.recursive ?? false });
  const done = consumeFsEvents(watcher, handler, options);
  return { watcher, done };
}
