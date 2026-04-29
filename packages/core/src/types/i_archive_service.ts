/**
 * @module IArchiveService
 * @path packages/core/src/types/i_archive_service.ts
 * @description Interface for execution archive services.
 * @architectural-layer Shared
 * @related-files [src/services/adapters/archive_adapter.ts, src/cli/cli_context.ts]
 */

import type { MemoryStatusType } from "@exaix/core";

export interface IArchiveEntry {
  trace_id: string;
  identity_id: string;
  status: MemoryStatusType | string;
  archived_at: string;
}

export interface IArchiveService {
  /**
   * Search for archived entries in a date range.
   */
  searchByDateRange(start: string, end: string): Promise<IArchiveEntry[]>;

  /**
   * Search for archived entries by agent ID.
   */
  searchByAgent(identityId: string): Promise<IArchiveEntry[]>;

  /**
   * Get an archived entry by its trace ID.
   */
  getByTraceId(traceId: string): Promise<IArchiveEntry | null>;

  /**
   * Get an archived trace file content (e.g. plan or request).
   */
  getTrace(traceId: string): Promise<unknown>;
}
