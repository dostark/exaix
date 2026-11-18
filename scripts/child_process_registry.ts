#!/usr/bin/env -S deno run -A
/**
 * @module ChildProcessRegistry
 * @path scripts/child_process_registry.ts
 * @description The pids of the child processes a test batch started and has not reaped, shared by both runners.
 * Usage: imported as a library by `scripts/test_parallel.ts` and `scripts/test_isolation.ts`.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [scripts/test_parallel.ts, scripts/test_isolation.ts]
 */

/** The pids of the children that a batch started and has not reaped. */
const ACTIVE_CHILD_PIDS = new Set<number>();

/** The tracked children, for the shutdown path that kills them. */
export function activeChildPids(): ReadonlySet<number> {
  return ACTIVE_CHILD_PIDS;
}

/** Track one child so the shutdown path can kill it. */
export function trackChild(pid: number): void {
  ACTIVE_CHILD_PIDS.add(pid);
}

/** Remove a child's pid once it has exited. */
export function untrackChild(pid: number): void {
  ACTIVE_CHILD_PIDS.delete(pid);
}
