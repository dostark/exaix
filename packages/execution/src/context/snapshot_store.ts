/**
 * @module SnapshotStore
 * @path packages/execution/src/context/snapshot_store.ts
 * @description ISnapshotStore interface and FileSnapshotStore implementation.
 * Persists IContextBudgetSnapshot to Memory/Execution/{traceId}/ using atomic write.
 * All traceId values are validated before path construction to prevent path traversal.
 * @architectural-layer Services
 * @dependencies [
 *   "@exaix/schemas/execution/context_budget.ts",
 *   "@exaix/portal"
 * ]
 * @related-files [
 *   "packages/execution/src/context/context_budget_manager.ts",
 *   "packages/portal/src/path_resolver.ts"
 * ]
 */

import type { IContextBudgetSnapshot } from "@exaix/schemas/execution/context_budget.ts";

/** Minimal path resolver interface — satisfied by both real PathResolver and test mocks. */
export interface ISnapshotPathResolver {
  resolve(path: string): Promise<string>;
}

/** Persists budget snapshots for later inspection or compaction audit. */
export interface ISnapshotStore {
  save(snapshot: IContextBudgetSnapshot): Promise<void>;
}

/** Error thrown when a snapshot traceId fails security validation. */
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

const VALID_TRACE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_STEP_ID_RE = /^[a-zA-Z0-9_-]{1,256}$/;

/** Atomic write (temp file + rename); PathResolver confines the resolved path to the
 *  workspace root. */
export class FileSnapshotStore implements ISnapshotStore {
  constructor(private readonly pathResolver: ISnapshotPathResolver) {}

  async save(snapshot: IContextBudgetSnapshot): Promise<void> {
    if (!VALID_TRACE_ID_RE.test(snapshot.traceId)) {
      throw new SecurityError(
        `Invalid traceId: "${snapshot.traceId}" — must match /^[a-zA-Z0-9_-]{1,128}$/`,
      );
    }

    if (!VALID_STEP_ID_RE.test(snapshot.stepId)) {
      throw new SecurityError(
        `Invalid stepId: "${snapshot.stepId}" — must match /^[a-zA-Z0-9_-]{1,256}$/`,
      );
    }

    const aliasedPath = `@Memory/Execution/${snapshot.traceId}/${snapshot.stepId}_snapshot.json`;
    const resolvedPath = await this.pathResolver.resolve(aliasedPath);
    const dir = resolvedPath.slice(0, resolvedPath.lastIndexOf("/"));

    await Deno.mkdir(dir, { recursive: true });

    const tmpPath = `${resolvedPath}.tmp`;
    await Deno.writeTextFile(tmpPath, JSON.stringify(snapshot, null, 2));
    await Deno.rename(tmpPath, resolvedPath);
  }
}
