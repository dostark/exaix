/**
 * @module ArchiveService
 * @path src/services/artifact/archive_service.ts
 * @description Manages persistence of execution plans and metadata for long-term storage.
 * @architectural-layer Services
 * * @related-files [src/services/execution_loop.ts, src/enums.ts]
 */
import { join } from "@std/path";
import { exists } from "@std/fs";
import { z } from "zod";
import { ArchiveStatus } from "@exaix/core";

export const ArchiveEntrySchema = z.object({
  trace_id: z.string().uuid(),
  request_id: z.string(),
  identity_id: z.string(),
  archived_at: z.string().datetime(),
  completed_at: z.string().datetime(),
  status: z.nativeEnum(ArchiveStatus),
  step_count: z.number(),
  duration_ms: z.number(),
  portal: z.string().optional(),
  tags: z.array(z.string()),
});

export type ArchiveEntry = z.infer<typeof ArchiveEntrySchema>;

export class ArchiveService {
  private archiveRoot: string;
  private indexPath: string;

  constructor(archiveRoot: string) {
    this.archiveRoot = archiveRoot;
    this.indexPath = join(this.archiveRoot, "index.json");
  }

  async archivePlan(entry: ArchiveEntry, planContent: string, requestContent: string): Promise<void> {
    const date = new Date(entry.archived_at);
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const dir = join(this.archiveRoot, year, month, entry.trace_id);
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(join(dir, "plan.md"), planContent);
    await Deno.writeTextFile(join(dir, "request.md"), requestContent);
    await Deno.writeTextFile(join(dir, "summary.json"), JSON.stringify(entry, null, 2));
    await this.updateIndex(entry);
  }

  async updateIndex(entry: ArchiveEntry): Promise<void> {
    let index: ArchiveEntry[] = [];
    if (await exists(this.indexPath)) {
      const raw = await Deno.readTextFile(this.indexPath);
      index = JSON.parse(raw);
    }
    index.push(entry);
    await Deno.writeTextFile(this.indexPath, JSON.stringify(index, null, 2));
  }

  async getByTraceId(traceId: string): Promise<ArchiveEntry | undefined> {
    if (!(await exists(this.indexPath))) return undefined;
    const raw = await Deno.readTextFile(this.indexPath);
    const index: ArchiveEntry[] = JSON.parse(raw);
    return index.find((e) => e.trace_id === traceId);
  }

  async searchByAgent(identityId: string): Promise<ArchiveEntry[]> {
    if (!(await exists(this.indexPath))) return [];
    const raw = await Deno.readTextFile(this.indexPath);
    const index: ArchiveEntry[] = JSON.parse(raw);
    return index.filter((e) => e.identity_id === identityId);
  }

  async searchByDateRange(start: string, end: string): Promise<ArchiveEntry[]> {
    if (!(await exists(this.indexPath))) return [];
    const raw = await Deno.readTextFile(this.indexPath);
    const index: ArchiveEntry[] = JSON.parse(raw);
    return index.filter((e) => e.archived_at >= start && e.archived_at <= end);
  }
}
