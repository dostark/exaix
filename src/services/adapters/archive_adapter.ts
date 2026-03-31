/**
 * @module ArchiveAdapter
 * @path src/services/adapters/archive_adapter.ts
 * @description Adapter for ArchiveService that satisfies the IArchiveService interface.
 * @architectural-layer Services/Adapters
 * * @related-files [src/shared/interfaces/i_archive_service.ts, src/services/artifcat/archive_service.ts] */

import type { IArchiveEntry, IArchiveService } from "../../shared/interfaces/i_archive_service.ts";
import type { ArchiveService } from "../artifact/archive_service.ts";

export class ArchiveAdapter implements IArchiveService {
  constructor(private inner: ArchiveService) {}

  async searchByDateRange(start: string, end: string): Promise<IArchiveEntry[]> {
    return await this.inner.searchByDateRange(start, end);
  }

  async searchByAgent(identityId: string): Promise<IArchiveEntry[]> {
    return await this.inner.searchByAgent(identityId);
  }

  async getByTraceId(traceId: string): Promise<IArchiveEntry | null> {
    const entry = await this.inner.getByTraceId(traceId);
    return entry ?? null;
  }

  async getTrace(traceId: string): Promise<unknown> {
    // Note: ArchiveService doesn't have a getTrace method yet, it has getByTraceId for metadata.
    // getTrace might be for fetching content. For now we return metadata.
    return await this.inner.getByTraceId(traceId);
  }
}
