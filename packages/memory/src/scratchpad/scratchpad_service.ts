/**
 * @module ScratchpadService
 * @path packages/memory/src/scratchpad/scratchpad_service.ts
 * @description Per-execution working-memory board: append-only JSONL capture of lightweight
 *   agent notes (remember_fact) under Memory/Execution/{trace_id}/scratchpad.jsonl. Deliberately
 *   dumb and cheap — no embedding, no confidence scoring, no global/project-memory write at
 *   capture time; extraction/curation (Step 10) owns everything beyond raw capture.
 *   Over-cap entries are rejected, never truncated (a truncated note silently changes meaning).
 * @architectural-layer Services
 * @related-files ["packages/memory/src/bank/memory_bank.ts", "packages/core/src/types/i_scratchpad_service.ts", "packages/core/src/events/domain_event_types.ts"]
 *
 * @visible
 */
import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import type { Config } from "@exaix/schemas/config.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { IToolResult, Opt, Reason } from "@exaix/core/types";
import type { IScratchpadEntry } from "@exaix/schemas/memory_bank.ts";
import {
  DEFAULT_EXECUTION_MEMORY_PATH,
  DEFAULT_SCRATCHPAD_MAX_ENTRIES_PER_EXECUTION,
  DEFAULT_SCRATCHPAD_MAX_ENTRY_BYTES,
} from "@exaix/core";

const SCRATCHPAD_FILENAME = "scratchpad.jsonl";

/** Per-execution scratchpad store: append-only JSONL capture scoped to one execution trace. */
export class ScratchpadService {
  private readonly executionDir: string;
  private readonly logger?: IEventLogger;
  private readonly encoder = new TextEncoder();

  constructor(config: Config, logger?: Opt<IEventLogger, Reason.OptionalDependency>) {
    this.executionDir = join(config.system.root!, config.paths.memory!, DEFAULT_EXECUTION_MEMORY_PATH);
    this.logger = logger;
  }

  /** Appends one entry to the execution's scratchpad; rejects over-cap content and exhausted entry budgets with a clear error. */
  async append(traceId: string, content: string, tags?: Opt<string[], Reason.OptionalInput>): Promise<IToolResult> {
    const contentBytes = this.encoder.encode(content).length;
    if (contentBytes > DEFAULT_SCRATCHPAD_MAX_ENTRY_BYTES) {
      return {
        success: false,
        error:
          `scratchpad entry rejected: ${contentBytes} bytes exceeds the ${DEFAULT_SCRATCHPAD_MAX_ENTRY_BYTES}-byte per-entry cap (content is not truncated)`,
      };
    }

    const scratchpadFile = join(this.executionDir, traceId, SCRATCHPAD_FILENAME);
    const entryCount = await this.countEntries(scratchpadFile);
    if (entryCount >= DEFAULT_SCRATCHPAD_MAX_ENTRIES_PER_EXECUTION) {
      return {
        success: false,
        error:
          `scratchpad full: max ${DEFAULT_SCRATCHPAD_MAX_ENTRIES_PER_EXECUTION} entries reached for this execution`,
      };
    }

    const entry: IScratchpadEntry = {
      id: crypto.randomUUID(),
      trace_id: traceId,
      content,
      ...(tags ? { tags } : {}),
      created_at: new Date().toISOString(),
    };

    await ensureDir(join(this.executionDir, traceId));
    // Single append-mode write per entry: O_APPEND keeps concurrent appends line-atomic.
    const file = await Deno.open(scratchpadFile, { append: true, create: true, write: true });
    try {
      await file.write(this.encoder.encode(JSON.stringify(entry) + "\n"));
    } finally {
      file.close();
    }

    this.logger?.info(
      DomainEventType.MemoryScratchpadEntryAdded,
      traceId,
      { trace_id: traceId, entry_id: entry.id, content_length: contentBytes },
      traceId,
    );

    return {
      success: true,
      data: { entry_id: entry.id, created_at: entry.created_at },
    };
  }

  /** Reads all scratchpad entries for traceId (empty when the execution wrote nothing). */
  async read(traceId: string): Promise<IScratchpadEntry[]> {
    const scratchpadFile = join(this.executionDir, traceId, SCRATCHPAD_FILENAME);
    if (!await exists(scratchpadFile)) {
      return [];
    }
    const raw = await Deno.readTextFile(scratchpadFile);
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as IScratchpadEntry);
  }

  private async countEntries(scratchpadFile: string): Promise<number> {
    if (!await exists(scratchpadFile)) {
      return 0;
    }
    const raw = await Deno.readTextFile(scratchpadFile);
    return raw.split("\n").filter((line) => line.trim().length > 0).length;
  }
}
