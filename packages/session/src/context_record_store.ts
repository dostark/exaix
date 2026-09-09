/**
 * @module ContextRecordStore
 * @path packages/session/src/context_record_store.ts
 * @description Immutable, owner-only-permissioned store for Phase 176 dogfood context
 * capture records — `@Memory/Execution/<trace>/context/<recordId>.json`. Validates every
 * id before path resolution, refuses symlink path components, never overwrites an
 * existing record, and implements `IContextInspectionReader` for read-only CLI inspection.
 * @architectural-layer Services
 * @related-files [packages/schemas/src/dogfood_context.ts, packages/core/src/types/i_dogfood_context.ts]
 */

import { dirname, join } from "@std/path";
import {
  type ContextRecord,
  ContextRecordSchema,
  type ContextRecordSummary,
  toContextRecordSummary,
} from "@exaix/schemas/dogfood_context.ts";
import type { IContextInspectionReader } from "@exaix/core/types";

/** Minimal path resolver dependency — satisfied by both the real PathResolver and test doubles. */
export interface IContextRecordPathResolver {
  resolve(path: string): Promise<string>;
}

/** Thrown when a trace/record/step id fails validation, or a symlink component is found
 *  where a plain directory is required. */
export class ContextRecordSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextRecordSecurityError";
  }
}

/** Thrown by `save` when a record with the same id has already been written — records
 *  are immutable once captured. */
export class ContextRecordAlreadyExistsError extends Error {
  constructor(recordId: string) {
    super(`Context record already exists and is immutable: ${recordId}`);
    this.name = "ContextRecordAlreadyExistsError";
  }
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const STEP_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const OWNER_ONLY_DIR_MODE = 0o700;
const OWNER_ONLY_FILE_MODE = 0o600;

/** Shared with `exactl request inspect` so its own input validation uses the exact same
 *  UUID shape check as the store, never a second regex that could drift from it. */
export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function assertValidUuid(value: string, label: string): void {
  if (!isValidUuid(value)) {
    throw new ContextRecordSecurityError(`Invalid ${label}: "${value}" — must be a UUID`);
  }
}

function assertValidStepId(value: string): void {
  if (!STEP_ID_PATTERN.test(value)) {
    throw new ContextRecordSecurityError(`Invalid stepId: "${value}" — must match ${STEP_ID_PATTERN}`);
  }
}

/** Writer plus the shared `IContextInspectionReader`, backed by PathResolver-confined
 *  atomic writes. Capture must succeed before child launch — callers should treat a
 *  thrown `save` as an abort, not a best-effort warning. */
export class ContextRecordStore implements IContextInspectionReader {
  constructor(private readonly pathResolver: IContextRecordPathResolver) {}

  /** Persists `record` immutably. Throws `ContextRecordAlreadyExistsError` if a record
   *  with this id already exists — records are never overwritten. */
  async save(record: ContextRecord): Promise<void> {
    // Id shape is validated BEFORE schema parsing so a path-traversal-shaped id is
    // rejected with a distinct security error, not a generic schema validation error.
    assertValidUuid(record.recordId, "recordId");
    assertValidUuid(record.executionTraceId, "executionTraceId");
    assertValidStepId(record.stepId);
    const parsed = ContextRecordSchema.parse(record);

    const contextDir = await this.resolveContextDir(parsed.executionTraceId);
    await Deno.mkdir(contextDir, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
    await this.assertNoSymlinkComponents(contextDir);

    const finalPath = join(contextDir, `${parsed.recordId}.json`);
    if (await this.exists(finalPath)) {
      throw new ContextRecordAlreadyExistsError(parsed.recordId);
    }

    // Revalidate immediately before the exclusive write (TOCTOU: the directory could
    // have been replaced with a symlink between the check above and this write).
    await this.assertNoSymlinkComponents(contextDir);

    const tmpPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
    await Deno.writeTextFile(tmpPath, JSON.stringify(parsed, null, 2), { mode: OWNER_ONLY_FILE_MODE });
    try {
      await Deno.rename(tmpPath, finalPath);
    } catch (error) {
      await Deno.remove(tmpPath).catch(() => {});
      throw error;
    }
  }

  async list(traceId: string): Promise<readonly ContextRecordSummary[]> {
    assertValidUuid(traceId, "traceId");
    const contextDir = await this.resolveContextDir(traceId);

    const summaries: ContextRecordSummary[] = [];
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(contextDir));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return [];
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      const raw = await Deno.readTextFile(join(contextDir, entry.name));
      const record = ContextRecordSchema.parse(JSON.parse(raw));
      summaries.push(toContextRecordSummary(record));
    }

    summaries.sort((a, b) =>
      a.sequence - b.sequence ||
      a.turn - b.turn ||
      a.attempt - b.attempt ||
      a.timestamp.localeCompare(b.timestamp) ||
      a.recordId.localeCompare(b.recordId)
    );
    return summaries;
  }

  async read(traceId: string, recordId: string): Promise<ContextRecord> {
    assertValidUuid(traceId, "traceId");
    assertValidUuid(recordId, "recordId");
    const contextDir = await this.resolveContextDir(traceId);
    const raw = await Deno.readTextFile(join(contextDir, `${recordId}.json`));
    return ContextRecordSchema.parse(JSON.parse(raw));
  }

  /** Bounded scan of the store's own `@Memory/Execution` root (never a caller-supplied
   *  path) for every record whose `parentTraceId` matches — the CLI's fallback when a
   *  caller supplies the governing trace rather than a specific child execution trace. */
  async listByParentTrace(parentTraceId: string): Promise<readonly ContextRecordSummary[]> {
    assertValidUuid(parentTraceId, "parentTraceId");
    const executionRoot = await this.pathResolver.resolve("@Memory/Execution");

    let traceEntries: Deno.DirEntry[];
    try {
      traceEntries = await Array.fromAsync(Deno.readDir(executionRoot));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return [];
      throw error;
    }

    const summaries: ContextRecordSummary[] = [];
    for (const traceEntry of traceEntries) {
      if (!traceEntry.isDirectory) continue;
      const contextDir = join(executionRoot, traceEntry.name, "context");
      let recordEntries: Deno.DirEntry[];
      try {
        recordEntries = await Array.fromAsync(Deno.readDir(contextDir));
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) continue;
        throw error;
      }
      for (const recordEntry of recordEntries) {
        if (!recordEntry.isFile || !recordEntry.name.endsWith(".json")) continue;
        const raw = await Deno.readTextFile(join(contextDir, recordEntry.name));
        const record = ContextRecordSchema.parse(JSON.parse(raw));
        if (record.parentTraceId === parentTraceId) {
          summaries.push(toContextRecordSummary(record));
        }
      }
    }

    summaries.sort((a, b) =>
      a.sequence - b.sequence ||
      a.turn - b.turn ||
      a.attempt - b.attempt ||
      a.timestamp.localeCompare(b.timestamp) ||
      a.recordId.localeCompare(b.recordId)
    );
    return summaries;
  }

  /** Removes every captured record older than `retentionDays` (by `timestamp`) across
   *  every trace. Age-based, not live trace-status — narrower than "completed/expired
   *  traces only", but safe in practice at the default 7-day window. Returns count removed. */
  async pruneExpired(retentionDays: number, now: Date): Promise<number> {
    const executionRoot = await this.pathResolver.resolve("@Memory/Execution");
    let traceEntries: Deno.DirEntry[];
    try {
      traceEntries = await Array.fromAsync(Deno.readDir(executionRoot));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return 0;
      throw error;
    }

    const cutoffMs = now.getTime() - retentionDays * MS_PER_DAY;
    let prunedCount = 0;

    for (const traceEntry of traceEntries) {
      if (!traceEntry.isDirectory) continue;
      const contextDir = join(executionRoot, traceEntry.name, "context");
      let recordEntries: Deno.DirEntry[];
      try {
        recordEntries = await Array.fromAsync(Deno.readDir(contextDir));
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) continue;
        throw error;
      }
      for (const recordEntry of recordEntries) {
        if (!recordEntry.isFile || !recordEntry.name.endsWith(".json")) continue;
        const recordPath = join(contextDir, recordEntry.name);
        const raw = await Deno.readTextFile(recordPath);
        const record = ContextRecordSchema.parse(JSON.parse(raw));
        if (Date.parse(record.timestamp) < cutoffMs) {
          await Deno.remove(recordPath);
          prunedCount++;
        }
      }
    }

    return prunedCount;
  }

  private async resolveContextDir(traceId: string): Promise<string> {
    return await this.pathResolver.resolve(`@Memory/Execution/${traceId}/context`);
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await Deno.lstat(path);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  }

  /** Walks every existing ancestor of `path` up to (and including) the `@Memory` root
   *  and refuses if any is a symlink — bounded to the app's own controlled root so an
   *  unrelated symlinked system ancestor (e.g. a symlinked /tmp) is never inspected. */
  private async assertNoSymlinkComponents(path: string): Promise<void> {
    const memoryRoot = await this.pathResolver.resolve("@Memory");
    let current = path;
    while (current === memoryRoot || current.startsWith(`${memoryRoot}/`)) {
      try {
        const stat = await Deno.lstat(current);
        if (stat.isSymlink) {
          throw new ContextRecordSecurityError(`Refusing symlink path component: ${current}`);
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
}
