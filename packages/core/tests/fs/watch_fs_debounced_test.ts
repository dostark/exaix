/**
 * @module WatchFsDebouncedTest
 * @path packages/core/tests/fs/watch_fs_debounced_test.ts
 * @description RED-first tests for the canonical Deno.watchFs consumption helper. Deno.watchFs has no
 *   built-in idempotency — it emits multiple/duplicate FsEvents per change (OS-dependent), so every
 *   consumer must debounce, dedup, and isolate per-event errors or risk double-processing and loop
 *   crashes (the Phase 128 session-return bug). This helper encodes that pattern once.
 * @architectural-layer Shared
 * @related-files [packages/core/src/fs/watch_fs_debounced.ts, apps/daemon/src/session_return_watcher.ts]
 */

import { assertEquals } from "@std/assert";
import { consumeFsEvents, type IFsEventLike } from "@exaix/core/fs";

/** Build an async iterable of fake FsEvents so tests need no real filesystem. */
async function* events(...evs: IFsEventLike[]): AsyncIterableIterator<IFsEventLike> {
  for (const e of evs) yield e;
}

const ev = (kind: string, ...paths: string[]): IFsEventLike => ({ kind, paths });

Deno.test("[watchFsDebounced] debounces a burst of events for one path into a single handler call", async () => {
  const seen: string[] = [];
  await consumeFsEvents(
    events(ev("create", "/w/a.md"), ev("modify", "/w/a.md"), ev("modify", "/w/a.md")),
    (path) => {
      seen.push(path);
    },
    { debounceMs: 5 },
  );
  // Three events for the same path collapse to one handler invocation.
  assertEquals(seen, ["/w/a.md"]);
});

Deno.test("[watchFsDebounced] filters out non-write event kinds (default FS_WRITE_EVENT_KINDS)", async () => {
  const seen: string[] = [];
  await consumeFsEvents(
    events(ev("access", "/w/a.md"), ev("modify", "/w/b.md"), ev("any", "/w/c.md")),
    (path) => {
      seen.push(path);
    },
    { debounceMs: 5 },
  );
  assertEquals(seen, ["/w/b.md"]);
});

Deno.test("[watchFsDebounced] a throwing handler does NOT crash the loop — onError is called, processing continues", async () => {
  const errors: string[] = [];
  const seen: string[] = [];
  await consumeFsEvents(
    events(ev("modify", "/w/bad.md"), ev("modify", "/w/good.md")),
    (path) => {
      if (path.endsWith("bad.md")) throw new Error("boom");
      seen.push(path);
    },
    {
      debounceMs: 5,
      onError: (err, path) => {
        errors.push(`${path}:${err.message}`);
      },
    },
  );
  // The throw on bad.md is isolated; good.md still processes.
  assertEquals(errors, ["/w/bad.md:boom"]);
  assertEquals(seen, ["/w/good.md"]);
});

Deno.test("[watchFsDebounced] shouldProcess predicate suppresses handler when it returns false (dedup/content guard)", async () => {
  const seen: string[] = [];
  await consumeFsEvents(
    events(ev("modify", "/w/x.md"), ev("modify", "/w/y.md")),
    (path) => {
      seen.push(path);
    },
    {
      debounceMs: 5,
      shouldProcess: (path) => path.endsWith("y.md"), // only y is "really changed"
    },
  );
  assertEquals(seen, ["/w/y.md"]);
});
