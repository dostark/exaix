/**
 * @module CoreFs
 * @path packages/core/src/fs/mod.ts
 * @description Filesystem helpers shared across Exaix. Currently the canonical Deno.watchFs
 *   consumption pattern (debounce + dedup + per-event error isolation).
 * @architectural-layer Shared
 * @related-files [packages/core/src/fs/watch_fs_debounced.ts]
 */

export { consumeFsEvents, watchFsDebounced } from "./watch_fs_debounced.ts";
export type { IFsEventLike, IWatchFsDebouncedOptions } from "./watch_fs_debounced.ts";
